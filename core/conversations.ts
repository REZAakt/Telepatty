import type { ChatMessageRow, ConversationRow, MessageState } from './db'

/**
 * Pure conversation-summary logic. Everything the chat list needs is derived here
 * from a single message, so the list never has to look at the `messages` table.
 */

export const PREVIEW_MAX = 120

/** Monotonic strength of each state, used to never downgrade a tick. */
const STATE_RANK: Record<MessageState, number> = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 }

export interface SummaryMessage {
  id: string
  chatId: string
  body: string
  lamport: number
  ts: number
  state: MessageState
  direction: 'in' | 'out'
  /** file messages summarize as an attachment preview, not text */
  kind?: 'text' | 'image' | 'video' | 'file'
  /** file name for the chat-list preview of `file` messages */
  fileLabel?: string
}

export interface SummaryOptions {
  /** conversation currently open in the UI — incoming messages are not counted */
  openChatId?: string | null
  /** peer muted: still summarized, but the counter is not bumped */
  muted?: boolean
  /** false only for replayed/backfilled writes that must not touch the counter */
  countUnread?: boolean
  /** falsy → the counter comes from `unreadCount` in `opts.unreadCount` instead */
  now?: number
}

/** Plain-text, whitespace-collapsed, truncated preview of a message body. */
export function previewOf(body: string | undefined, max = PREVIEW_MAX): string {
  const s = (body ?? '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

export function emptyConversation(peerPubkey: string, now = Date.now()): ConversationRow {
  return {
    id: peerPubkey,
    peerPubkey,
    lastMessagePreview: '',
    lastMessageAt: 0,
    lastLamport: 0,
    unreadCount: 0,
    pinned: 0,
    muted: 0,
    archived: 0,
    updatedAt: now,
  }
}

function shouldCountUnread(msg: SummaryMessage, opts: SummaryOptions): boolean {
  if (msg.direction !== 'in') return false
  if (!opts.countUnread) return false
  if (opts.muted) return false
  if (opts.openChatId && opts.openChatId === msg.chatId) return false
  return true
}

/** Does this message become the new "last message" of the conversation? */
function isNewest(prev: ConversationRow, msg: SummaryMessage): boolean {
  if (!prev.lastMessageId) return true
  if (msg.lamport !== prev.lastLamport) return msg.lamport > prev.lastLamport
  // same lamport (e.g. our own optimistic row vs. the echoed one): keep the newest id
  return msg.id >= prev.lastMessageId
}

/**
 * Fold one message into a conversation summary.
 * Order-safe: an older (lower-lamport) message that arrives late only bumps the
 * unread counter, it never overwrites a newer preview.
 */
export function applyMessageToConversation(
  prev: ConversationRow | undefined,
  msg: SummaryMessage,
  opts: SummaryOptions = {},
): ConversationRow {
  const now = opts.now ?? Date.now()
  const base = prev ?? emptyConversation(msg.chatId, now)
  const next: ConversationRow = { ...base, updatedAt: now }

  if (isNewest(base, msg)) {
    next.lastMessageId = msg.id
    next.lastMessagePreview = previewOf(msg.body)
    next.lastMessageKind = msg.kind && msg.kind !== 'text' ? msg.kind : undefined
    if (msg.kind === 'file') next.lastMessagePreview = previewOf(msg.fileLabel ?? '')
    next.lastMessageAt = msg.ts || now
    next.lastLamport = msg.lamport
    next.lastMessageStatus = msg.state
    next.lastMessageDirection = msg.direction
  }
  if (shouldCountUnread(msg, opts)) next.unreadCount = base.unreadCount + 1
  return next
}

/** Fold a state change (delivered/read/failed) into the summary. */
export function applyStatusToConversation(
  prev: ConversationRow | undefined,
  update: { id: string; state: MessageState },
  now = Date.now(),
): ConversationRow | undefined {
  if (!prev || prev.lastMessageId !== update.id) return undefined
  const current = prev.lastMessageStatus ?? 'pending'
  if (STATE_RANK[update.state] <= STATE_RANK[current]) return undefined
  return { ...prev, lastMessageStatus: update.state, updatedAt: now }
}

/** Summary produced when a chat is opened: unread is drained. */
export function applyReadToConversation(prev: ConversationRow | undefined, now = Date.now()): ConversationRow | undefined {
  if (!prev || prev.unreadCount === 0) return undefined
  return { ...prev, unreadCount: 0, updatedAt: now }
}

/** Rebuild a summary from scratch (migration, repair, import). */
export function summarizeMessages(
  chatId: string,
  messages: SummaryMessage[],
  opts: { unreadFrom?: number; now?: number } = {},
): ConversationRow {
  const now = opts.now ?? Date.now()
  let row = emptyConversation(chatId, now)
  const sorted = [...messages].sort((a, b) => (a.lamport !== b.lamport ? a.lamport - b.lamport : a.ts - b.ts))
  for (const m of sorted) row = applyMessageToConversation(row, m, { now, countUnread: false })
  // unread is reconstructed from the messages themselves (incoming, not read yet)
  row.unreadCount = sorted.filter((m) => m.direction === 'in' && m.state !== 'read').length
  if (opts.unreadFrom !== undefined) row.unreadCount = Math.min(row.unreadCount, opts.unreadFrom)
  return row
}

/** Total unread badge = sum of the summaries' counters. */
export function totalUnread(rows: { unreadCount?: number }[]): number {
  let n = 0
  for (const row of rows) n += row.unreadCount || 0
  return n
}

/** Chat list order: pinned first, then most recent activity. */
export function compareConversations(a: ConversationRow, b: ConversationRow): number {
  const pin = (b.pinned ?? 0) - (a.pinned ?? 0)
  if (pin !== 0) return pin
  // activity = the last message time; chats without messages fall back to the
  // summary update time so the tie-break matches what the list displays
  const actA = a.lastMessageAt || a.updatedAt
  const actB = b.lastMessageAt || b.updatedAt
  if (actA !== actB) return actB - actA
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Pinning is capped so the pinned section can never swallow the list
 * (requirement: at most 3 pinned chats).
 */
export const MAX_PINNED_CHATS = 3

/** Pure pin guard: pinning is allowed when already pinned OR under the cap. */
export function canPinChat(currentlyPinned: boolean, pinnedCount: number): boolean {
  return currentlyPinned || pinnedCount < MAX_PINNED_CHATS
}

export function isMuted(row: ConversationRow, now = Date.now()): boolean {
  return !!row.muted || (row.mutedUntil !== undefined && row.mutedUntil > now)
}

export function summarizeRow(row: ChatMessageRow): SummaryMessage {
  return {
    id: row.id,
    chatId: row.chatId,
    body: row.body,
    lamport: row.lamport,
    ts: row.ts,
    state: row.state,
    direction: row.direction,
    kind: row.kind ?? 'text',
    fileLabel: row.fileMeta?.name,
  }
}
