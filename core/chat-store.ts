import type { Envelope } from './protocol'
import type { ChatMessageRow, ConversationRow, MessageState, TelepattyDb } from './db'
import { kindForMime } from './files'
import { emitBus } from './bus'
import {
  applyMessageToConversation,
  applyReadToConversation,
  applyStatusToConversation,
  compareConversations,
  emptyConversation,
  isMuted,
  previewOf,
  summarizeRow,
} from './conversations'

/** messages loaded per page in the chat window */
export const PAGE_SIZE = 40
/** how many chats stay warm in the in-memory window cache */
export const CHAT_WINDOW_CACHE = 3
/** safety window for incremental sync: NIP-59 randomizes wrap timestamps into the past */
export const SYNC_SAFETY_WINDOW_MS = 2 * 86_400_000
/** catch-up page size when replaying from a checkpoint */
export const SYNC_LIMIT = 1_000
/** processed-event ids older than this are pruned */
export const PROCESSED_TTL_MS = 14 * 86_400_000
/** upper bound for `[chatId+lamport]` range scans */
export const MAX_LAMPORT = Number.MAX_SAFE_INTEGER

export interface WriteOpts {
  /** conversation currently open in the UI: its unread counter is not bumped */
  openChatId?: string | null
  /** false for replayed/backfilled rows */
  countUnread?: boolean
  /** peer conversation is muted: summarize, but never count */
  muted?: boolean
  now?: number
}

export interface BulkImportResult {
  conversations: number
  messages: number
  ms: number
}

/** Envelope → message row (pure). */
export function messageFromEnvelope(env: Envelope, direction: 'in' | 'out', expireAt?: number): ChatMessageRow {
  const ts = env.ts || Date.now()
  const meta = env.file
  return {
    id: env.id,
    chatId: direction === 'in' ? env.from : env.to,
    from: env.from,
    to: env.to,
    body: env.body ?? '',
    replyTo: env.replyTo?.id,
    replyExcerpt: env.replyTo?.excerpt,
    replyFrom: env.replyTo?.senderPubkey,
    kind: meta ? kindForMime(meta.mime) : 'text',
    fileMeta: meta
      ? {
          transferId: meta.transferId,
          name: meta.name,
          mime: meta.mime,
          size: meta.size,
          sha256: meta.sha256,
          chunkSize: meta.chunkSize,
          thumb: meta.thumb,
        }
      : undefined,
    ts,
    lamport: env.lamport,
    state: direction === 'in' ? 'delivered' : 'pending',
    createdAt: ts,
    attempts: 0,
    nextAttemptAt: 0,
    direction,
    expireAt,
  }
}

/**
 * Write path #1 — insert or replace a message row and fold it into the summary.
 * Message, unread counter, preview and list order commit atomically in ONE Dexie
 * transaction, then announce themselves on the bus so the list + open chat update
 * incrementally (no re-queries, no frozen UI).
 */
export async function putMessage(db: TelepattyDb, row: ChatMessageRow, opts: WriteOpts = {}): Promise<ConversationRow> {
  const now = opts.now ?? Date.now()
  let conversation!: ConversationRow
  await db.transaction('rw', db.messages, db.conversations, async () => {
    const existing = await db.messages.get(row.id)
    await db.messages.put(row)
    const prev = await db.conversations.get(row.chatId)
    conversation = applyMessageToConversation(prev, row, {
      now,
      // a retry/re-delivery of a row we already stored must never count twice
      countUnread: opts.countUnread !== false && !existing,
      openChatId: opts.openChatId ?? null,
      // muted state travels with the summary row, so no extra read is needed
      muted: opts.muted ?? (prev ? isMuted(prev, now) : false),
    })
    await db.conversations.put(conversation)
  })
  emitBus('message', row)
    emitBus('conversation', conversation)
  return conversation
}

/**
 * Write path #1b — bulk variant used by the sync pipeline: rows are written in ONE
 * transaction, then each conversation summary is refreshed. Only genuinely new
 * rows (not already stored) bump the unread counter.
 */
export async function putMessages(db: TelepattyDb, rows: ChatMessageRow[], opts: WriteOpts = {}): Promise<ConversationRow[]> {
  if (!rows.length) return []
  const now = opts.now ?? Date.now()
  const touched = new Map<string, ConversationRow>()
  const fresh: ChatMessageRow[] = []
  await db.transaction('rw', db.messages, db.conversations, async () => {
    const ids = rows.map((r) => r.id)
    const existing = await db.messages.bulkGet(ids)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      await db.messages.put(row)
      const isNew = existing[i] === undefined
      if (isNew) fresh.push(row)
      const prev = touched.get(row.chatId) ?? (await db.conversations.get(row.chatId))
      const next = applyMessageToConversation(prev, row, {
        now,
        countUnread: opts.countUnread !== false && isNew,
        openChatId: opts.openChatId ?? null,
        muted: opts.muted ?? (prev ? isMuted(prev, now) : false),
      })
      touched.set(row.chatId, next)
      await db.conversations.put(next)
    }
  })
  for (const row of fresh) emitBus('message', row)
  for (const convo of touched.values()) emitBus('conversation', convo)
  return [...touched.values()]
}

/**
 * Chat list reads (ONLY the conversations table — see the chat-list test that spies
 * on `messages`). A `Dexie` table implements `.toArray()`, so this stays mockable.
 */
export interface ConversationTableLike {
  toArray: () => Promise<ConversationRow[]>
}
export interface ListReadDb {
  conversations: ConversationTableLike
}

/** Rows for the chat list, pinned first then most recent activity. */
export async function listConversations(db: ListReadDb): Promise<ConversationRow[]> {
  const rows = await db.conversations.toArray()
  return rows.sort(compareConversations)
}

/** Total unread badge = sum of the summaries' counters. */
export function totalUnread(rows: ConversationRow[]): number {
  let n = 0
  for (const row of rows) n += row.unreadCount || 0
  return n
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/* ------------------------------------------------------------------ */
/* Demo/seed import (dev only)                                         */
/* ------------------------------------------------------------------ */

export interface SeedPayload {
  chatIds: string[]
  /** flat message stream; summaries are rebuilt as a side effect */
  messages: ChatMessageRow[]
}

/** Import a generated dataset in chunks, yielding between them. */
export async function importSeed(
  db: TelepattyDb,
  payload: SeedPayload,
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<number> {
  const chunk = opts.chunk ?? 500
  const total = payload.messages.length
  let done = 0
  for (let i = 0; i < total; i += chunk) {
    await putMessages(db, payload.messages.slice(i, i + chunk), { countUnread: true })
    done = Math.min(total, i + chunk)
    opts.onProgress?.(done, total)
    await yieldToUi()
  }
    return done
}

/* ------------------------------------------------------------------ */
/* Write path #2/3 — state change, read, delete                        */
/* ------------------------------------------------------------------ */

/**
 * Update a message's delivery state (outbox `markSent`/`markFailed`, receipts).
 * Only advances the conversation's "last message status" tick, never downgrades it.
 */
export async function putMessageState(
  db: TelepattyDb,
  id: string,
  state: MessageState,
  opts: { now?: number; readAt?: number } = {},
): Promise<ChatMessageRow | undefined> {
  const now = opts.now ?? Date.now()
  let updated: ChatMessageRow | undefined
  let conversation: ConversationRow | undefined
  await db.transaction('rw', db.messages, db.conversations, async () => {
    const msg = await db.messages.get(id)
    if (!msg) return
    const noChange = msg.state === state && (opts.readAt === undefined || msg.readAt === opts.readAt)
    if (noChange) return
    msg.state = state
    if (opts.readAt !== undefined) msg.readAt = opts.readAt
    await db.messages.put(msg)
    updated = msg
    const prev = await db.conversations.get(msg.chatId)
    const next = applyStatusToConversation(prev, { id, state }, now)
    if (next) {
      await db.conversations.put(next)
      conversation = next
    }
  })
  if (updated) {
    emitBus('message-state', { chatId: updated.chatId, id, state })
    if (conversation) emitBus('conversation', conversation)
  }
  return updated
}

/**
 * Write path #3 — chat opened: drain the unread counter and mark incoming messages
 * read. Uses the [chatId+state] index, so only delivered rows are touched.
 * Returns the ids that flipped (the caller sends read receipts).
 */
export async function markChatRead(db: TelepattyDb, chatId: string, now = Date.now()): Promise<string[]> {
  let ids: string[] = []
  let conversation: ConversationRow | undefined
  await db.transaction('rw', db.messages, db.conversations, async () => {
    const delivered = await db.messages.where('[chatId+state]').equals([chatId, 'delivered']).toArray()
    ids = delivered.map((m) => m.id)
    for (const m of delivered) {
      m.state = 'read'
      m.readAt = now
      await db.messages.put(m)
    }
    const prev = await db.conversations.get(chatId)
    const next = applyReadToConversation(prev, now)
    if (next) {
      await db.conversations.put(next)
      conversation = next
    }
  })
  if (conversation) emitBus('conversation', conversation)
  if (ids.length) {
    emitBus('read', { chatId, ids })
    for (const id of ids) emitBus('message-state', { chatId, id, state: 'read' })
  }
    return ids
}

/** Delete one message locally (delete-for-me) and refresh the summary. */
export async function deleteMessage(db: TelepattyDb, chatId: string, id: string, now = Date.now()): Promise<void> {
  let removed = false
  let conversation: ConversationRow | undefined
  await db.transaction('rw', db.messages, db.conversations, db.files, async () => {
    const msg = await db.messages.get(id)
    if (!msg) return
    await db.messages.delete(id)
    removed = true
    // the blob of a deleted message is deleted with it
    await db.files.where('messageId').equals(id).delete()
    const prev = await db.conversations.get(chatId)
    if (!prev) return
    const droppedUnread = msg.direction === 'in' && msg.state !== 'read' ? 1 : 0
    if (prev.lastMessageId === id) {
      const fallback = await latestMessage(db, chatId)
      const base: ConversationRow = {
        ...prev,
        lastMessageId: undefined,
        lastMessagePreview: '',
        lastMessageAt: 0,
        lastLamport: 0,
        lastMessageStatus: undefined,
        lastMessageDirection: undefined,
      }
      const summary = fallback
        ? applyMessageToConversation(base, fallback, { now, countUnread: false })
        : base
      summary.unreadCount = Math.max(0, prev.unreadCount - droppedUnread)
      summary.updatedAt = now
      await db.conversations.put(summary)
      conversation = summary
    } else if (droppedUnread) {
      const summary = { ...prev, unreadCount: Math.max(0, prev.unreadCount - droppedUnread), updatedAt: now }
      await db.conversations.put(summary)
      conversation = summary
    }
  })
  if (removed) {
    emitBus('message-removed', { chatId, id })
    if (conversation) emitBus('conversation', conversation)
  }
}

/** Clear a chat's history: messages go, the conversation row stays (empty). */
export async function clearChatHistory(db: TelepattyDb, chatId: string, now = Date.now()): Promise<void> {
  let conversation: ConversationRow | undefined
  await db.transaction('rw', db.messages, db.conversations, db.files, async () => {
    await db.messages.where('chatId').equals(chatId).delete()
    await db.files.where('chatId').equals(chatId).delete()
    const prev = await db.conversations.get(chatId)
    const summary: ConversationRow = {
      ...(prev ?? emptyConversation(chatId, now)),
      lastMessageId: undefined,
      lastMessagePreview: '',
      lastMessageAt: 0,
      lastLamport: 0,
      lastMessageStatus: undefined,
      lastMessageDirection: undefined,
      unreadCount: 0,
      updatedAt: now,
    }
    await db.conversations.put(summary)
    conversation = summary
  })
  if (conversation) emitBus('conversation', conversation)
}

/** Remove a conversation entirely (delete chat / unfriend / block). */
export async function deleteConversation(db: TelepattyDb, chatId: string): Promise<void> {
  await db.transaction('rw', db.messages, db.conversations, db.files, async () => {
    await db.messages.where('chatId').equals(chatId).delete()
    await db.files.where('chatId').equals(chatId).delete()
    await db.conversations.delete(chatId)
  })
    emitBus('conversation-removed', chatId)
}

/** Pinned / muted / archived flags live on the summary too (the list sorts on them). */
export async function setConversationFlags(
  db: TelepattyDb,
  chatId: string,
  patch: { pinned?: boolean; muted?: boolean; archived?: boolean; unreadCount?: number },
  now = Date.now(),
): Promise<ConversationRow> {
  let conversation!: ConversationRow
  await db.transaction('rw', db.conversations, async () => {
    const prev = (await db.conversations.get(chatId)) ?? emptyConversation(chatId, now)
    conversation = {
      ...prev,
      pinned: patch.pinned === undefined ? prev.pinned : patch.pinned ? 1 : 0,
      muted: patch.muted === undefined ? prev.muted : patch.muted ? 1 : 0,
      archived: patch.archived === undefined ? prev.archived : patch.archived ? 1 : 0,
      unreadCount: patch.unreadCount === undefined ? prev.unreadCount : Math.max(0, patch.unreadCount),
      updatedAt: now,
    }
    await db.conversations.put(conversation)
  })
  emitBus('conversation', conversation)
  return conversation
}

/** Paging cursor: `cursor` is the lamport of the oldest returned row. */
export interface MessagePage {
  rows: ChatMessageRow[]
  /** true when older messages exist before the first row */
  hasMore: boolean
  /** pass as `beforeLamport` for the next (older) page */
  cursor: number | null
}

/**
 * Cache-first read: newest `limit` messages of one chat through `[chatId+lamport]`,
 * returned oldest-first. `beforeLamport` walks further into the past.
 */
export async function pageMessages(
  db: TelepattyDb,
  chatId: string,
  opts: { limit?: number; beforeLamport?: number } = {},
): Promise<MessagePage> {
  const limit = opts.limit ?? PAGE_SIZE
  const from = opts.beforeLamport
  const upper: [string, number] = [chatId, from === undefined ? MAX_LAMPORT : from]
  const rows = await db.messages
    .where('[chatId+lamport]')
    .between([chatId, 0], upper, true, from === undefined)
    .reverse()
    .limit(limit + 1)
    .toArray()
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  page.reverse()
  return { rows: page, hasMore, cursor: page[0]?.lamport ?? null }
}

/** Newest message of a chat (used when a summary has to be rebuilt). */
export async function latestMessage(db: TelepattyDb, chatId: string): Promise<ChatMessageRow | undefined> {
  const rows = await db.messages
    .where('[chatId+lamport]')
    .between([chatId, 0], [chatId, MAX_LAMPORT], true, true)
    .reverse()
    .limit(1)
    .toArray()
    return rows[0]
}

/* ------------------------------------------------------------------ */
/* Cache-first repair tool (Settings → Storage)                         */
/* ------------------------------------------------------------------ */

export interface RebuildResult {
  conversations: number
  messages: number
  ms: number
}

/**
 * Rebuild every conversation summary from the messages table. Chunked and
 * yield-friendly so the UI never freezes. Exposed in Settings → Storage as the
 * "Rebuild conversation summaries" repair tool (and used after a v2 backup import).
 */
export async function rebuildConversationSummaries(
  db: TelepattyDb,
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<RebuildResult> {
  const chunk = opts.chunk ?? 2_000
  const started = Date.now()
  const chatIds = (await db.messages.orderBy('chatId').uniqueKeys()).map(String)
  const summaries = new Map((await db.conversations.toArray()).map((row) => [row.id, row]))
  let processed = 0
  let lastYield = 0

  for (const chatId of chatIds) {
    const rows = await db.messages
      .where('[chatId+lamport]')
      .between([chatId, 0], [chatId, MAX_LAMPORT], true, true)
      .toArray()
    const prev = summaries.get(chatId) ?? emptyConversation(chatId)
    let summary: ConversationRow = {
      ...prev,
      lastMessageId: undefined,
      lastMessagePreview: '',
      lastMessageAt: 0,
      lastLamport: 0,
      lastMessageStatus: undefined,
      lastMessageDirection: undefined,
      unreadCount: 0,
    }
    const stamp = Date.now()
    for (const m of rows) summary = applyMessageToConversation(summary, m, { now: stamp, countUnread: false })
    summary.unreadCount = rows.filter((m) => m.direction === 'in' && m.state !== 'read').length
    summaries.set(chatId, summary)
    processed += rows.length
    opts.onProgress?.(processed, processed)
    if (processed - lastYield >= chunk) {
      lastYield = processed
      await yieldToUi()
    }
  }
  await db.conversations.bulkPut([...summaries.values()])
  return { conversations: summaries.size, messages: processed, ms: Date.now() - started }
}

/**
 * Self-heal for a database the v4 upgrade left behind: `conversations` empty while
 * `messages` is not is the fingerprint of a backfill that ran in an already
 * deactivated versionchange transaction (see `backfillConversations`) — the schema
 * commits, the summaries never get written, and the chat list stays empty forever
 * because the upgrade never runs again. The probe is a bounded `limit(1)` read, so
 * the check is safe on every start; the rebuild only runs when it is needed.
 * Only this total-loss case is auto-detected (a partial summary set still needs the
 * Settings → Storage "Rebuild conversation summaries" tool).
 * Returns null when there was nothing to repair.
 */
export async function ensureConversationSummaries(db: TelepattyDb): Promise<RebuildResult | null> {
  if ((await db.conversations.limit(1).first()) !== undefined) return null
  if ((await db.messages.limit(1).first()) === undefined) return null
  return rebuildConversationSummaries(db)
}

/* ------------------------------------------------------------------ */
/* processedEvents — a gift wrap is NEVER decrypted twice              */
/* ------------------------------------------------------------------ */

/** A wrap id we already handled (so we never decrypt it again). */
export async function isEventProcessed(db: TelepattyDb, id: string): Promise<boolean> {
  return (await db.processedEvents.get(id)) !== undefined
}

/** Which of these wrap ids were not processed yet? Checked BEFORE decrypt. */
export async function filterUnprocessed(db: TelepattyDb, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const hit = await db.processedEvents.bulkGet(ids)
  return ids.filter((_, i) => hit[i] === undefined)
}

export async function markEventsProcessed(
  db: TelepattyDb,
  ids: string[],
  outcome = 'message',
  now = Date.now(),
): Promise<void> {
  if (!ids.length) return
  await db.processedEvents.bulkPut(ids.map((id) => ({ id, receivedAt: now, outcome })))
}

/** TTL pruning (default 14 days) so the table cannot grow forever. */
export async function pruneProcessedEvents(db: TelepattyDb, now = Date.now(), ttl = PROCESSED_TTL_MS): Promise<number> {
  const keys = await db.processedEvents.where('receivedAt').below(now - ttl).primaryKeys()
  if (keys.length) await db.processedEvents.bulkDelete(keys)
  return keys.length
}

/* ------------------------------------------------------------------ */
/* syncState — per-relay incremental sync checkpoints                  */
/* ------------------------------------------------------------------ */

export function syncStateId(relay: string, recipientPk: string, kind = 'inbox'): string {
  return `${relay}|${recipientPk}|${kind}`
}

export async function getSyncState(db: TelepattyDb, relay: string, recipientPk: string, kind = 'inbox') {
  return db.syncState.get(syncStateId(relay, recipientPk, kind))
}

export async function getSyncStatesFor(db: TelepattyDb, recipientPk: string, kind = 'inbox') {
  return db.syncState.filter((row) => row.kind === kind && row.recipientPk === recipientPk).toArray()
}

/** Newest checkpoint across relays (drives the incremental `since`). */
export async function newestSyncCheckpoint(db: TelepattyDb, recipientPk: string, kind = 'inbox'): Promise<number> {
  const rows = await getSyncStatesFor(db, recipientPk, kind)
  return rows.reduce((acc, row) => Math.max(acc, row.lastEventAt || 0), 0)
}

export async function saveSyncState(
  db: TelepattyDb,
  state: { relay: string; recipientPk: string; kind?: string; lastEventAt?: number; eose?: boolean; now?: number },
): Promise<void> {
  const kind = state.kind ?? 'inbox'
  await db.syncState.put({
    id: syncStateId(state.relay, state.recipientPk, kind),
    relay: state.relay,
    recipientPk: state.recipientPk,
    kind,
    lastEventAt: state.lastEventAt ?? 0,
    lastSyncedAt: state.now ?? Date.now(),
    eose: state.eose ? 1 : undefined,
  })
}

/** Chat-list preview text (plain text, truncated to PREVIEW_MAX). */
export function previewText(body: string | undefined): string {
  return previewOf(body)
}





