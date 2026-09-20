import { defineStore } from 'pinia'
import type { ChatMessageRow } from '~~/core/db'
import { getDb } from '~~/core/db'
import type { Envelope } from '~~/core/protocol'
import { compareMessages } from '~~/core/receive'
import { useContactsStore } from './contacts'
import { getMessenger, type Messenger } from '../services/messenger'


export interface Convo {
  chatId: string
  unread: number
  typingUntil: number
  last?: ChatMessageRow
}

export const useChatsStore = defineStore('chats', {
  state: () => ({
    messages: {} as Record<string, ChatMessageRow[]>,
    convos: {} as Record<string, Convo>,
    loaded: false,
  }),
  getters: {
    sorted: (s) => (chatId: string) => [...(s.messages[chatId] ?? [])].sort(compareMessages),
    chatIds: (s) => Object.keys(s.convos),
    visibleChatIds(): string[] {
      const contacts = useContactsStore()
      // friends appear as chats even before the first message is exchanged
      const ids = new Set<string>(this.chatIds)
      for (const f of contacts.friends) ids.add(f.pk)
      return [...ids]
        .filter((id) => contacts.friendPks.has(id) || contacts.incomingRequests.some((r) => r.pk === id))
        .filter((id) => !(contacts.friend(id)?.archived ?? false))
        .sort((a, b) => {
          const ta = this.convos[a]?.last?.createdAt ?? contacts.friend(a)?.addedAt ?? 0
          const tb = this.convos[b]?.last?.createdAt ?? contacts.friend(b)?.addedAt ?? 0
          return tb - ta
        })
    },

    totalUnread: (s) => Object.values(s.convos).reduce((acc, c) => acc + c.unread, 0),
  },
  actions: {
    async load(): Promise<void> {
      const db = getDb()
      const all = await db.messages.toArray()
      const map: Record<string, ChatMessageRow[]> = {}
      const convos: Record<string, Convo> = {}
      for (const m of all) {
        ;(map[m.chatId] ??= []).push(m)
      }
      for (const [chatId, msgs] of Object.entries(map)) {
        const last = [...msgs].sort((a, b) => a.createdAt - b.createdAt).at(-1)
        convos[chatId] = { chatId, unread: 0, typingUntil: 0, last }
      }
      this.messages = map
      this.convos = convos
      this.loaded = true
    },
    upsertMessage(msg: ChatMessageRow, opts: { countUnread?: boolean } = {}): void {
      const list = this.messages[msg.chatId] ?? []
      const i = list.findIndex((m) => m.id === msg.id)
      const row = { ...msg }
      if (i >= 0) list.splice(i, 1, row)
      else list.push(row)
      this.messages[msg.chatId] = list
      const convo = this.convos[msg.chatId] ?? { chatId: msg.chatId, unread: 0, typingUntil: 0 }
      convo.last = row
      if (opts.countUnread && msg.direction === 'in' && !(msg.state === 'read')) convo.unread += 1
      this.convos[msg.chatId] = convo
    },
    async markRead(chatId: string): Promise<void> {
      const convo = this.convos[chatId]
      if (!convo?.unread) return
      convo.unread = 0
      getMessenger()?.sendReadReceipts(chatId)
    },
    setTyping(chatId: string, until: number): void {
      const convo = this.convos[chatId] ?? { chatId, unread: 0, typingUntil: 0 }
      convo.typingUntil = until
      this.convos[chatId] = convo
      setTimeout(() => {
        const c = this.convos[chatId]
        if (c && c.typingUntil <= Date.now()) c.typingUntil = 0
      }, Math.max(1000, until - Date.now()))
    },
    removeMessage(chatId: string, id: string): void {
      const list = this.messages[chatId]
      if (!list) return
      const next = list.filter((m) => m.id !== id)
      this.messages[chatId] = next
      void getDb().messages.delete(id)
      const convo = this.convos[chatId]
      if (convo && convo.last?.id === id) convo.last = [...next].sort((a, b) => a.createdAt - b.createdAt).at(-1)
    },
    async clearHistory(chatId: string): Promise<void> {
      const db = getDb()
      await db.messages.where('chatId').equals(chatId).delete()
      this.messages[chatId] = []
      const convo = this.convos[chatId]
      if (convo) convo.last = undefined
    },
    removeConvo(chatId: string): void {
      const { [chatId]: _m, ...mRest } = this.messages
      const { [chatId]: _c, ...cRest } = this.convos
      this.messages = mRest as Record<string, ChatMessageRow[]>
      this.convos = cRest
    },

    /** last known lamport for a conversation */
    lastLamport(chatId: string): number {
      const list = this.messages[chatId] ?? []
      return list.reduce((acc, m) => Math.max(acc, m.lamport), 0)
    },
    envelopeToMessage(env: Envelope, direction: 'in' | 'out', expireAt?: number): ChatMessageRow {
      return {
        id: env.id,
        chatId: direction === 'in' ? env.from : env.to,
        from: env.from,
        to: env.to,
        body: env.body ?? '',
        replyTo: env.replyTo,
        ts: env.ts,
        lamport: env.lamport,
        state: direction === 'in' ? 'delivered' : 'pending',
        createdAt: Date.now(),
        attempts: 0,
        nextAttemptAt: 0,
        expireAt,
        direction,
      }
    }
  },
})

