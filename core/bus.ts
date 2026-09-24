import type { ChatMessageRow, ConversationRow } from './db'

/**
 * Tiny in-process event bus. The receive pipeline (and every write path) emits
 * here; the chat list and the open chat window subscribe and update incrementally
 * instead of re-querying the database. Multi-tab stays fresh through Dexie
 * liveQuery / BroadcastChannel, this bus is per-tab.
 */

export interface ChatMessageUpdate {
  chatId: string
  id: string
  state: ChatMessageRow['state']
}

export interface FileTransferUpdate {
  chatId: string
  messageId: string
  progress: number
  direction: 'in' | 'out'
}

export interface FileTransferDone {
  chatId: string
  messageId: string
  fileId: string
  direction: 'in' | 'out'
}

/** the bytes of a file message are on disk now (readable under `fileId`) */
export interface FileStored {
  chatId: string
  messageId: string
  fileId: string
  direction: 'in' | 'out'
}

export interface FileTransferFailed {
  chatId: string
  messageId: string
  reason: string
  direction: 'in' | 'out'
}

export interface BusEvents {
  /** a message row was inserted or replaced */
  message: ChatMessageRow
  /** only the delivery state changed (receipts, outbox) */
  'message-state': ChatMessageUpdate
  /** a message row disappeared (delete for me / expiry / clear history) */
  'message-removed': { chatId: string; id: string }
  /** a conversation summary changed */
  conversation: ConversationRow
  /** a conversation disappeared (delete chat) */
  'conversation-removed': string
  /** a chat was opened/read: these incoming ids were marked as read */
  read: { chatId: string; ids: string[] }
  /** file transfer progress 0..1 (both directions) */
  'file-progress': FileTransferUpdate
  /** the received file is verified + stored; fileId references the blob */
  'file-done': FileTransferDone
  /** a file's BYTES were written (any direction). A bubble may legitimately be
   *  announced before its blob — this event lets it resolve the URL once the
   *  bytes land, so "empty bubble until reload" cannot come back. */
  'file-stored': FileStored
  /** transfer aborted: rejected/quota/hash/size/cancelled */
  'file-failed': FileTransferFailed
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

const handlers = new Map<keyof BusEvents, Set<Handler<never>>>()

export function onBus<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
  }
  set.add(handler as Handler<never>)
  return () => offBus(event, handler)
}

export function offBus<K extends keyof BusEvents>(event: K, handler: Handler<K>): void {
  handlers.get(event)?.delete(handler as Handler<never>)
}

export function emitBus<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  const set = handlers.get(event)
  if (!set) return
  for (const h of [...set]) {
    try {
      ;(h as Handler<K>)(payload)
    } catch (e) {
      console.error(`[telepatty] bus handler for "${String(event)}" failed`, e)
    }
  }
}

/** Drop every subscriber (tests / full reload). */
export function resetBus(): void {
  handlers.clear()
}
