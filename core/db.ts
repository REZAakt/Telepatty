import Dexie, { type Table } from 'dexie'
import { applyMessageToConversation, emptyConversation } from './conversations'

export interface IdentityRow {
  id: 'me'
  pk: string
  /** hex secret key — encrypted when app lock is enabled */
  sk: string
  displayName?: string
  phone?: string
  createdAt: number
  /** when set, `sk` holds an encrypted blob and unlocking requires the passphrase */
  lock?: LockBlob
  /** session must be re-unlocked after this time (60 days by default) */
  sessionExpiresAt?: number
}

export interface LockBlob {
  salt: string
  iv: string
  ct: string
  iterations: number
}

export interface FriendRow {
  pk: string
  /** label from the invite (unverified) */
  name?: string
  /** local nickname set by the user */
  nickname?: string
  phone?: string
  addedAt: number
  verified: boolean
  pinned: boolean
  mutedUntil?: number
  archived: boolean
  /** disappearing timer seconds; 0/undefined = off */
  expireAfter?: number
}

export interface RequestRow {
  pk: string
  name?: string
  at: number
  direction: 'in' | 'out'
}

export interface BlockRow {
  pk: string
  at: number
}

export type MessageState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export type MessageKind = 'text' | 'image' | 'video' | 'file'

/** On-disk file blob + metadata (schema v5). Messages reference `id` via fileId. */
export interface FileRow {
  id: string
  chatId: string
  /** owning message id, when known (outgoing rows get it immediately) */
  messageId?: string
  name: string
  mime: string
  size: number
  blob: Blob
  direction: 'in' | 'out'
  createdAt: number
  /** disappearing expiry mirrored from the message (purged together) */
  expireAt?: number
}

export interface ChatMessageRow {
  id: string
  chatId: string
  from: string
  to: string
  body: string
  /** id of the quoted message (denormalised from the envelope ReplyRef) */
  replyTo?: string
  /** snippet of the quoted message (carried in the envelope, survives expiry) */
  replyExcerpt?: string
  /** sender of the quoted message */
  replyFrom?: string
  kind?: MessageKind
  /** files-table row holding the blob (set once transferred) */
  fileId?: string
  /** file metadata header for file messages (no blob here, that lives in files) */
  fileMeta?: { transferId: string; name: string; mime: string; size: number; sha256: string; chunkSize: number; thumb?: string }
  ts: number
  lamport: number
  state: MessageState
  createdAt: number
  attempts: number
  nextAttemptAt: number
  expireAt?: number
  direction: 'out' | 'in'
  /** set when the peer read it (drives the unread index/repair) */
  readAt?: number
}

/**
 * One row per 1-to-1 conversation. Everything the chat list renders lives here so
 * the list never has to read (or count) the `messages` table.
 */
export interface ConversationRow {
  /** = peer public key (hex), same value the router uses as `chatId` */
  id: string
  peerPubkey: string
  lastMessageId?: string
  /** plain-text preview, truncated (see core/conversations.ts) */
  lastMessagePreview: string
  /** 'image' | 'video' | 'file' when the last message is an attachment (list shows a localized label) */
  lastMessageKind?: 'image' | 'video' | 'file'
  lastMessageAt: number
  /** lamport of the last message — ordering key, survives clock skew */
  lastLamport: number
  lastMessageStatus?: ChatMessageRow['state']
  lastMessageDirection?: 'in' | 'out'
  unreadCount: number
  /** 0/1: Dexie indexes booleans poorly, integers sort correctly */
  pinned: number
  muted: number
  mutedUntil?: number
  archived: number
  updatedAt: number
}

/** A NIP-59 gift wrap we already tried to process (never decrypt twice). */
export interface ProcessedEventRow {
  /** outer wrapper event id */
  id: string
  receivedAt: number
  /** 'message' | 'ignored' — kept for debugging/support */
  outcome?: string
}

/** Incremental sync checkpoint, per relay + recipient key. */
export interface SyncStateRow {
  /** `${relay}|${recipientPk}|${kind}` */
  id: string
  relay: string
  recipientPk: string
  kind: string
  /** newest `created_at` we have fully processed from this relay */
  lastEventAt: number
  lastSyncedAt: number
  /** true once EOSE was seen at least once */
  eose?: number
}

export interface QueueRow {
  /** envelope id */
  id: string
  env: string
  attempts: number
  nextAt: number
  lastError?: string
}

export interface SettingRow {
  key: string
  value: unknown
}

export const SCHEMA_VERSION = 5

/** Chunk size for the v4 conversation backfill (keeps the upgrade tx responsive). */
export const MIGRATION_CHUNK = 500

export class TelepattyDb extends Dexie {
  identity!: Table<IdentityRow, string>
  friends!: Table<FriendRow, string>
  requests!: Table<RequestRow, string>
  blocks!: Table<BlockRow, string>
  messages!: Table<ChatMessageRow, string>
  files!: Table<FileRow, string>
  conversations!: Table<ConversationRow, string>
  processedEvents!: Table<ProcessedEventRow, string>
  syncState!: Table<SyncStateRow, string>
  queue!: Table<QueueRow, string>
  settings!: Table<SettingRow, string>

  constructor(name = 'telepatty') {
    super(name)
    // v1: initial schema (no expireAt index, disappearing messages not yet supported)
    this.version(1).stores({
      identity: 'id',
      friends: 'pk, addedAt',
      requests: 'pk, at',
      blocks: 'pk',
      messages: 'id, chatId, state, nextAttemptAt, [chatId+lamport]',
      queue: 'id, nextAt',
      settings: 'key',
    })
    // v2: disappearing messages — add expireAt index and backfill from legacy per-chat timers
    this.version(2)
      .stores({
        messages: 'id, chatId, state, nextAttemptAt, expireAt, [chatId+lamport]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('messages')
          .toCollection()
          .modify((msg: ChatMessageRow & { ttlDays?: number }) => {
            if (msg.ttlDays && msg.ttlDays > 0 && !msg.expireAt) {
              msg.expireAt = msg.createdAt + msg.ttlDays * 86_400_000
              delete msg.ttlDays
            }
          })
      })
    // v3: lamport must be its own index (orderBy('lamport') requires it)
    this.version(3).stores({
      messages: 'id, chatId, state, nextAttemptAt, expireAt, lamport, [chatId+lamport]',
    })
    // v4: local-first conversations — summarized chat list, dedupe + sync checkpoints.
    // (The spec called this "v3"; v3 was already taken by the lamport index, so the
    //  summary schema ships as v4 — see DECISIONS.md.)
    this.version(4)
      .stores({
        messages: 'id, chatId, state, nextAttemptAt, expireAt, lamport, readAt, [chatId+lamport], [chatId+state]',
        conversations: 'id, peerPubkey, lastMessageAt, unreadCount, [pinned+lastMessageAt]',
        processedEvents: 'id, receivedAt',
        syncState: 'id, relay, lastEventAt',
      })
      .upgrade(async (tx) => {
        await backfillConversations(tx)
      })
    // v5: file transfers — blob storage table (messages reference fileId).
    // No backfill needed: files only exist from v5 on. The `kind`/`fileId`/
    // `replyExcerpt` message fields are non-indexed, so no message schema bump.
    this.version(5).stores({
      files: 'id, chatId, messageId, createdAt, expireAt',
    })
  }
}

/** Message shape needed for a summary backfill. */
interface BackfillMessage {
  id: string
  chatId: string
  body: string
  lamport: number
  ts: number
  state: MessageState
  direction: 'in' | 'out'
}

/** Minimal Dexie surface the backfill needs (keeps this unit-testable without Dexie). */
export interface MigrationTx {
  table: (name: string) => {
    toCollection: () => { each: (cb: (row: unknown) => void | Promise<void>) => Promise<void> }
    bulkPut: (rows: readonly unknown[]) => Promise<unknown>
  }
}

/**
 * Fold every existing message into its conversation summary, in chunks, inside the
 * upgrade transaction (so a failed migration never leaves half a chat list).
 * Memory is O(conversations), not O(messages); summaries are flushed every
 * MIGRATION_CHUNK messages. Returns the number of conversations written.
 * Constructing the fold is synchronous on purpose: upgrade transactions are
 * hostile to asynchronous work.
 *
 * - Helpers must be imported statically. A dynamic `await import(...)` while the
 *   `versionchange` transaction is open yields to the event loop, the browser
 *   deactivates/commits the transaction, and the *next* cursor read dies with
 *   `TransactionInactiveError: Failed to execute 'openCursor' on 'IDBObjectStore':
 *   The transaction is not active.` (a busy/slow verchange lock auto-commits the
 *   transaction the same way).
 * - `.each()` records the promise an `async` callback returns but never chains the
 *   cursor on it, so an `async` callback lets the upgrade promise resolve first and
 *   swallows `TransactionInactiveError` into a silent, half-finished migration.
 *   The callback below is synchronous, so every cursor read happens in the same
 *   microtask scope as the writes.
 */
export function backfillConversations(tx: MigrationTx): Promise<number> {
  const rows = new Map<string, ConversationRow>()
  const dirty = new Set<string>()
  let seen = 0

  const flushed: ConversationRow[] = []
  const pending: Array<Promise<unknown>> = []
  const flush = (): void => {
    if (!dirty.size) return
    flushed.length = 0
    for (const chatId of dirty) {
      const row = rows.get(chatId)
      if (row) flushed.push(row)
    }
    dirty.clear()
    if (flushed.length) pending.push(tx.table('conversations').bulkPut(flushed.slice()))
  }

  return tx
    .table('messages')
    .toCollection()
    .each((raw: unknown) => {
      const m = raw as BackfillMessage
      if (!m || !m.chatId) return
      const base = rows.get(m.chatId) ?? emptyConversation(m.chatId, m.ts || Date.now())
      let next = applyMessageToConversation(base, m, { countUnread: false })
      // unread is reconstructed from the message itself, not from the write order
      if (m.direction === 'in' && m.state !== 'read') next = { ...next, unreadCount: base.unreadCount + 1 }
      rows.set(m.chatId, next)
      dirty.add(m.chatId)
      seen += 1
      if (seen % MIGRATION_CHUNK === 0) flush()
    })
    .then(async () => {
      flush()
      // the chunk writes were queued on this same transaction; awaiting them keeps
      // write errors visible, and the final (empty) bulkPut keeps the versionchange
      // transaction alive until they commit
      await Promise.all(pending)
      await tx.table('conversations').bulkPut([])
      return rows.size
    })
}


let dbSingleton: TelepattyDb | null = null

export function getDb(): TelepattyDb {
  if (!dbSingleton) dbSingleton = new TelepattyDb()
  return dbSingleton
}

export function setDb(db: TelepattyDb | null): void {
  dbSingleton = db
}

export async function getSetting<T>(db: TelepattyDb, key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}

export async function setSetting(db: TelepattyDb, key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
