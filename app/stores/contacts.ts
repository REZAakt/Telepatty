import { defineStore } from 'pinia'
import type { FriendRow, RequestRow, BlockRow } from '~~/core/db'
import { getDb } from '~~/core/db'
import { canPinChat } from '~~/core/conversations'
import { setConversationFlags } from '~~/core/chat-store'
import type { Envelope } from '~~/core/protocol'
import { PROTOCOL_VERSION } from '~~/core/protocol'
import { newId } from '~~/core/ids'

export const useContactsStore = defineStore('contacts', {
  state: () => ({
    friends: [] as FriendRow[],
    requests: [] as RequestRow[],
    blocks: [] as BlockRow[],
  }),
  getters: {
    friendPks: (s) => new Set(s.friends.map((f) => f.pk)),
    blockedPks: (s) => new Set(s.blocks.map((b) => b.pk)),
    outgoingPending: (s) => new Set(s.requests.filter((r) => r.direction === 'out').map((r) => r.pk)),
    incomingRequests: (s) => s.requests.filter((r) => r.direction === 'in'),
    outgoingRequests: (s) => s.requests.filter((r) => r.direction === 'out'),
    /** how many chats are currently pinned (pin cap: MAX_PINNED_CHATS) */
    pinnedCount: (s) => s.friends.reduce((n, f) => (f.pinned ? n + 1 : n), 0),
    displayName(): (pk: string) => string {
      return (pk: string) => {
        const f = this.friends.find((x) => x.pk === pk)
        if (f?.nickname) return f.nickname
        if (f?.name) return f.name
        const r = this.requests.find((x) => x.pk === pk)
        return r?.name ?? shortPk(pk)
      }
    },
    friend: (s) => (pk: string) => s.friends.find((f) => f.pk === pk),
  },
  actions: {
    async load(): Promise<void> {
      const db = getDb()
      this.friends = await db.friends.toArray()
      this.requests = await db.requests.toArray()
      this.blocks = await db.blocks.toArray()
    },
    async putFriend(row: FriendRow): Promise<void> {
      const db = getDb()
      await db.friends.put(row)
      const i = this.friends.findIndex((f) => f.pk === row.pk)
      if (i >= 0) this.friends.splice(i, 1, row)
      else this.friends.push(row)
    },
    async ensureFriend(pk: string, name?: string): Promise<void> {
      const existing = this.friend(pk)
      if (existing) return
      await this.putFriend({ pk, name, addedAt: Date.now(), verified: false, pinned: false, archived: false })
    },
    async rename(pk: string, nickname: string): Promise<void> {
      const f = this.friend(pk)
      if (f) await this.putFriend({ ...f, nickname: nickname || undefined })
    },
    /**
     * Pin/unpin a chat, enforcing the MAX_PINNED_CHATS cap.
     * Returns `false` (and does nothing) when the cap is reached — callers
     * surface a localized "pin limit" toast.
     */
    async togglePin(pk: string): Promise<boolean> {
      const f = this.friend(pk)
      if (!f) return false
      if (!canPinChat(f.pinned, this.pinnedCount)) return false
      await this.putFriend({ ...f, pinned: !f.pinned })
      // mirror on the conversation summary too (list sort + DB sort stay in sync)
      await setConversationFlags(getDb(), pk, { pinned: !f.pinned })
      return true
    },
    /**
     * Force the archived flag (both directions) and return the resulting state.
     * The flag MUST land in both stores: the friend row (source of truth for the
     * contact panel) and the conversation summary (what the chat list hides on).
     * The summary is only touched when it already exists — flag writes must never
     * materialize an EMPTY chat row for a friend who never exchanged a message
     * (that would inject a phantom chat into the list).
     */
    async setArchived(pk: string, archived: boolean): Promise<void> {
      const db = getDb()
      const f = this.friend(pk)
      if (f && f.archived !== archived) await this.putFriend({ ...f, archived })
      if (await db.conversations.get(pk)) await setConversationFlags(db, pk, { archived })
    },
    /** Archive ⇄ unarchive a chat; returns the new archived state. */
    async toggleArchive(pk: string): Promise<boolean> {
      const f = this.friend(pk)
      if (!f) return false
      const archived = !f.archived
      await this.setArchived(pk, archived)
      return archived
    },
    async mute(pk: string, until: number): Promise<void> {
      const f = this.friend(pk)
      if (f) await this.putFriend({ ...f, mutedUntil: until })
    },
    async setDisappearing(pk: string, seconds: number): Promise<void> {
      const f = this.friend(pk)
      if (f) await this.putFriend({ ...f, expireAfter: seconds })
    },
    async setVerified(pk: string, verified: boolean): Promise<void> {
      const f = this.friend(pk)
      if (f) await this.putFriend({ ...f, verified })
    },
    async unfriend(pk: string, deleteHistory: boolean): Promise<void> {
      const db = getDb()
      await db.friends.delete(pk)
      this.friends = this.friends.filter((f) => f.pk !== pk)
      await this.removeRequest(pk)
      if (deleteHistory) {
        const { useChatsStore } = await import('./chats')
        await db.messages.where('chatId').equals(pk).delete()
        useChatsStore().removeConvo(pk)
      }
    },
    /**
     * Block a contact. Blocking also removes the chat thread: the friend row
     * disappears and their traffic is dropped by `core/receive`, so a lingering
     * thread could never be answered — it would just sit in the list forever as a
     * dead "Blocked" row. `deleteChat` stays as an escape hatch for a caller that
     * must keep the history, and defaults to `true` so every entry point (friends
     * list, pending requests, chat contact panel) behaves identically.
     * `deleteConversation` drops messages + blobs + the summary and announces
     * itself on the bus, so the chat list loses the row in the same tick.
     */
    async block(pk: string, deleteChat = true): Promise<void> {
      const db = getDb()
      const at = Date.now()
      await db.blocks.put({ pk, at })
      this.blocks = [...this.blocks.filter((b) => b.pk !== pk), { pk, at }]
      await db.friends.delete(pk)
      this.friends = this.friends.filter((f) => f.pk !== pk)
      await this.removeRequest(pk)
      if (deleteChat) {
        // awaited: the deletion is PART of blocking, and callers navigate away
        // right after — a fire-and-forget delete could lose the race
        const { useChatsStore } = await import('./chats')
        await useChatsStore().deleteChat(pk)
      }
    },

    async unblock(pk: string): Promise<void> {
      const db = getDb()
      await db.blocks.delete(pk)
      this.blocks = this.blocks.filter((b) => b.pk !== pk)
    },
    async addRequest(pk: string, name: string | undefined, direction: 'in' | 'out'): Promise<void> {
      const db = getDb()
      const row: RequestRow = { pk, name, at: Date.now(), direction }
      await db.requests.put(row)
      this.requests = [...this.requests.filter((r) => r.pk !== pk), row]
    },
    async removeRequest(pk: string): Promise<void> {
      const db = getDb()
      await db.requests.delete(pk)
      this.requests = this.requests.filter((r) => r.pk !== pk)
    },
    /** Build a friend request envelope (unsigned; transport seals it). */
    buildFriendRequest(mePk: string, toPk: string, name?: string): Envelope {
      return {
        id: newId(),
        v: PROTOCOL_VERSION,
        type: 'friend_request',
        from: mePk,
        to: toPk,
        ts: Date.now(),
        lamport: 0,
        name: name?.slice(0, 64),
      }
    },
  },
})

function shortPk(pk: string): string {
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : ''
}
