import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { TelepattyDb, type ChatMessageRow } from './db'
import {
  ensureConversationSummaries,
  filterUnprocessed,
  listConversations,
  markChatRead,
  markEventsProcessed,
  pageMessages,
  putMessage,
} from './chat-store'

const dbName = () => 'chat-store-' + Math.random().toString(36).slice(2)

function msg(patch: Partial<ChatMessageRow> & Pick<ChatMessageRow, 'id' | 'chatId' | 'lamport'>): ChatMessageRow {
  return {
    from: 'a',
    to: 'b',
    body: patch.body ?? patch.id,
    ts: patch.lamport,
    state: 'delivered',
    createdAt: patch.lamport,
    attempts: 0,
    nextAttemptAt: 0,
    direction: 'in',
    ...patch,
  }
}

beforeEach(() => {
  Dexie.debug = false
})

describe('conversation-first chat store', () => {
  it('lists conversations without reading messages', async () => {
    const messages = { toArray: vi.fn(() => { throw new Error('messages must not be read') }) }
    const rows = await listConversations({
      messages,
      conversations: { toArray: vi.fn(async () => [
        { id: 'b', peerPubkey: 'b', lastMessagePreview: 'b', lastMessageAt: 1, lastLamport: 1, unreadCount: 0, pinned: 0, muted: 0, archived: 0, updatedAt: 1 },
        { id: 'a', peerPubkey: 'a', lastMessagePreview: 'a', lastMessageAt: 2, lastLamport: 1, unreadCount: 1, pinned: 0, muted: 0, archived: 0, updatedAt: 2 },
      ]) },
    })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(messages.toArray).not.toHaveBeenCalled()
  })

  it('keeps unread counters correct for incoming, own, muted, open and read', async () => {
    const db = new TelepattyDb(dbName())
    await db.open()
    await putMessage(db, msg({ id: 'in-1', chatId: 'c1', lamport: 1, direction: 'in' }), { countUnread: true })
    expect((await db.conversations.get('c1'))?.unreadCount).toBe(1)
    await putMessage(db, msg({ id: 'out-1', chatId: 'c1', lamport: 2, direction: 'out', state: 'pending' }), { countUnread: true })
    expect((await db.conversations.get('c1'))?.unreadCount).toBe(1)
    await putMessage(db, msg({ id: 'muted-1', chatId: 'c1', lamport: 3, direction: 'in' }), { countUnread: true, muted: true })
    expect((await db.conversations.get('c1'))?.unreadCount).toBe(1)
    await putMessage(db, msg({ id: 'open-1', chatId: 'c1', lamport: 4, direction: 'in' }), { countUnread: true, openChatId: 'c1' })
    expect((await db.conversations.get('c1'))?.unreadCount).toBe(1)
    const readIds = await markChatRead(db, 'c1')
    expect(readIds).toContain('in-1')
    expect((await db.conversations.get('c1'))?.unreadCount).toBe(0)
    db.close()
  })

  it('filters processed events before decrypt work runs', async () => {
    const db = new TelepattyDb(dbName())
    await db.open()
    await markEventsProcessed(db, ['seen'])
    expect(await filterUnprocessed(db, ['seen', 'fresh'])).toEqual(['fresh'])
    db.close()
  })

  it('pages by lamport cursor without overlap', async () => {
    const db = new TelepattyDb(dbName())
    await db.open()
    for (let i = 1; i <= 5; i++) await putMessage(db, msg({ id: `m${i}`, chatId: 'c1', lamport: i }), { countUnread: false })
    const first = await pageMessages(db, 'c1', { limit: 2 })
    expect(first.rows.map((m) => m.id)).toEqual(['m4', 'm5'])
    expect(first.cursor).toBe(4)
    const second = await pageMessages(db, 'c1', { limit: 2, beforeLamport: first.cursor ?? undefined })
    expect(second.rows.map((m) => m.id)).toEqual(['m2', 'm3'])
    db.close()
  })

  it('self-heals a database whose upgrade committed without summaries', async () => {
    const db = new TelepattyDb(dbName())
    await db.open()
    // pretend the v4 upgrade committed the schema but never wrote the summaries:
    // messages exist in the messages table, `conversations` is empty
    await db.messages.bulkPut([
      msg({ id: 'm1', chatId: 'c1', lamport: 1, state: 'delivered' }),
      msg({ id: 'm2', chatId: 'c1', lamport: 2, state: 'read' }),
      msg({ id: 'm3', chatId: 'c2', lamport: 1, direction: 'out', state: 'sent' }),
    ])
    expect(await db.conversations.count()).toBe(0)

    const repaired = await ensureConversationSummaries(db)
    expect(repaired?.conversations).toBe(2)
    expect(repaired?.messages).toBe(3)

    const c1 = await db.conversations.get('c1')
    expect(c1?.lastMessageId).toBe('m2')
    expect(c1?.lastMessagePreview).toBe('m2')
    expect(c1?.unreadCount).toBe(1)
    expect((await db.conversations.get('c2'))?.unreadCount).toBe(0)

    // healthy database → no-op (and never a second rebuild)
    expect(await ensureConversationSummaries(db)).toBeNull()
    db.close()
  })

  it('self-heal is a no-op on an empty database', async () => {
    const db = new TelepattyDb(dbName())
    await db.open()
    expect(await ensureConversationSummaries(db)).toBeNull()
    expect(await db.conversations.count()).toBe(0)
    db.close()
  })
})
