import { defineStore } from 'pinia'
import { liveQuery, type Subscription } from 'dexie'
import type { ConversationRow } from '~~/core/db'
import { getDb } from '~~/core/db'
import { compareConversations, isMuted, totalUnread as sumUnread } from '~~/core/conversations'
import {
  clearChatHistory,
  deleteConversation,
  deleteMessage,
  ensureConversationSummaries,
  listConversations,
  markChatRead,
  setConversationFlags,
} from '~~/core/chat-store'
import { onBus } from '~~/core/bus'
import { mark, measure } from '~~/core/perf'
import { useContactsStore } from './contacts'
import { getMessenger } from '../services/messenger'


export interface ChatListRow {
  id: string
  name: string
  pinned: boolean
  muted: boolean
  verified: boolean
  blocked: boolean
  archived: boolean
  typing: boolean
  unread: number
  preview: string
  /** 'image' | 'video' | 'file' when the last message is an attachment (preview is a localized label) */
  lastKind?: 'image' | 'video' | 'file'
  /** sort key: last activity, falling back to when the friend was added */
  activityAt: number
  lastDirection?: 'in' | 'out'
  lastStatus?: ConversationRow['lastMessageStatus']
}

/**
 * Chat list state. Reads ONLY the `conversations` table (live subscription), never
 * `messages`: every message body is already summarized there, so the list costs
 * O(chats) instead of O(all messages). No message arrays are kept in Pinia.
 */
export const useChatsStore = defineStore('chats', {
  state: () => ({
    /** live rows straight from the conversations table */
    rows: [] as ConversationRow[],
    loaded: false,
    /** chat currently open — incoming messages there are not counted as unread */
    openChatId: '' as string,
    /** typing indicator expiry per chat (ephemeral, never persisted) */
    typing: {} as Record<string, number>,
    sub: null as Subscription | null,
    busOffs: [] as (() => void)[],
    typedTimers: [] as ReturnType<typeof setTimeout>[],
  }),

  getters: {
    /**
     * Chat list rows — ALWAYS sorted here (pinned first, then most recent
     * activity). Sorting in the getter (not in the DB row order) guarantees the
     * list order follows the newest message even if the stored row order is
     * stale (requirement: the chat with the latest message is on top).
     */
    list(state): ChatListRow[] {
      const contacts = useContactsStore()
      const now = Date.now()
      return state.rows
        .map((row) => {
          const friend = contacts.friend(row.id)
          return {
            id: row.id,
            name: contacts.displayName(row.id),
            pinned: row.pinned === 1 || friend?.pinned === true,
            muted: isMuted(row, now) || (friend?.mutedUntil ?? 0) > now,
            verified: friend?.verified === true,
            blocked: contacts.blockedPks.has(row.id),
            archived: row.archived === 1 || friend?.archived === true,
            typing: (state.typing[row.id] ?? 0) > now,
            unread: row.unreadCount || 0,
            preview: row.lastMessagePreview,
            lastKind: row.lastMessageKind,
            activityAt: row.lastMessageAt || friend?.addedAt || row.updatedAt,
            lastDirection: row.lastMessageDirection,
            lastStatus: row.lastMessageStatus,
          }
        })
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          if (a.activityAt !== b.activityAt) return b.activityAt - a.activityAt
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        })
    },

    /** Default view hides archived chats. */
    visible(state): ChatListRow[] {
      return this.list.filter((r) => !r.archived)
    },

    totalUnread(state): number {
      return sumUnread(state.rows)
    },

    row: (state) => (chatId: string): ConversationRow | undefined => state.rows.find((r) => r.id === chatId),

    unreadFor: (state) => (chatId: string): number => state.rows.find((r) => r.id === chatId)?.unreadCount ?? 0,

    /** Last known lamport of a conversation (survives page reloads). */
    lastLamport: (state) => (chatId: string): number => state.rows.find((r) => r.id === chatId)?.lastLamport ?? 0,
  },

  actions: {
    /** Render from IndexedDB immediately; live updates arrive through liveQuery + the bus. */
    async load(): Promise<void> {
      const db = getDb()
      this.dispose()
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0
      this.rows = await listConversations(db)
      this.loaded = true
      mark('chat-list-ready')
      measure('chat-list-ready', 'chat-list-ready')
      if (import.meta.dev && t0) console.info(`[telepatty:perf] chat list from cache ${Math.round(performance.now() - t0)}ms (${this.rows.length} chats)`)

      this.sub = liveQuery(() => listConversations(db)).subscribe({
        next: (rows) => {
          this.rows = rows
        },
        error: (err) => console.error('[telepatty] conversation liveQuery failed', err),
      })

      // the bus patches the row in the same tick as the write, so the list never
      // waits for the liveQuery round-trip (and never re-reads messages)
      this.busOffs.push(
        onBus('conversation', (row) => this.applyRow(row)),
        onBus('conversation-removed', (id) => {
          this.rows = this.rows.filter((r) => r.id !== id)
        }),
      )

      // self-heal: an interrupted v4 upgrade can commit the schema without writing
      // any summaries (messages present, conversations empty). The upgrade never runs
      // again, so the list would stay empty — the liveQuery above picks up the rebuild.
      void ensureConversationSummaries(db)
        .then((repaired) => {
          if (repaired) {
            console.info(
              `[telepatty] conversation summaries rebuilt: ${repaired.conversations} chats / ${repaired.messages} messages in ${repaired.ms}ms`,
            )
          }
        })
        .catch((err) => console.error('[telepatty] conversation summary repair failed', err))
    },

    dispose(): void {
      this.sub?.unsubscribe()
      this.sub = null
      for (const off of this.busOffs) off()
      this.busOffs = []
      for (const t of this.typedTimers) clearTimeout(t)
      this.typedTimers = []
    },

    applyRow(row: ConversationRow): void {
      const i = this.rows.findIndex((r) => r.id === row.id)
      if (i < 0) this.rows = [...this.rows, row].sort(compareConversations)
      else this.rows = this.rows.map((r) => (r.id === row.id ? row : r)).sort(compareConversations)
    },

    /**
     * Chat opened: drain the unread counter, flip incoming messages to `read` and
     * send the receipts. The DB part is one transaction (core/chat-store), the state
     * patch reaches this store through the bus in the same tick.
     */
    async markRead(chatId: string): Promise<void> {
      this.openChatId = chatId
      // the messenger owns the whole flow: one transaction drains the counter and
      // flips incoming rows to `read`, then it sends a receipt per flipped id
      const messenger = getMessenger()
      if (messenger) await messenger.sendReadReceipts(chatId)
      else await markChatRead(getDb(), chatId)
    },

    openChat(chatId: string): void {
      this.openChatId = chatId
    },
    closeChat(chatId?: string): void {
      if (!chatId || this.openChatId === chatId) this.openChatId = ''
    },

    setTyping(chatId: string, until: number): void {
      this.typing = { ...this.typing, [chatId]: until }
      const timer = setTimeout(() => {
        const next = { ...this.typing }
        delete next[chatId]
        this.typing = next
      }, Math.max(0, until - Date.now()) + 50)
      this.typedTimers.push(timer)
      if (this.typedTimers.length > 40) this.typedTimers.splice(0, 20)
    },

    async removeMessage(chatId: string, id: string): Promise<void> {
      await deleteMessage(getDb(), chatId, id)
    },

    async clearHistory(chatId: string): Promise<void> {
      await clearChatHistory(getDb(), chatId)
    },

    async removeConvo(chatId: string): Promise<void> {
      await deleteConversation(getDb(), chatId)
    },

    /** Pin/mute/archive live on the summary (list order), mirrored on the friend row. */
    async setFlags(
      chatId: string,
      patch: { pinned?: boolean; muted?: boolean; archived?: boolean; unreadCount?: number },
    ): Promise<void> {
      const contacts = useContactsStore()
      const friend = contacts.friend(chatId)
      if (friend) {
        const next = { ...friend }
        if (patch.pinned !== undefined) next.pinned = patch.pinned
        if (patch.archived !== undefined) next.archived = patch.archived
        if (patch.muted !== undefined) next.mutedUntil = patch.muted ? Number.MAX_SAFE_INTEGER : undefined
        await contacts.putFriend(next)
      }
      await setConversationFlags(getDb(), chatId, patch)
    },
  },
})


