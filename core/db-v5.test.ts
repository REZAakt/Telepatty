import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { TelepattyDb, SCHEMA_VERSION } from './db'
import { purgeExpired } from './purge'

/** A v4 database (before the files table existed). */
class LegacyDbV4 extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      identity: 'id',
      friends: 'pk, addedAt',
      requests: 'pk, at',
      blocks: 'pk',
      messages: 'id, chatId, state, nextAttemptAt, [chatId+lamport]',
      queue: 'id, nextAt',
      settings: 'key',
    })
    this.version(4).stores({
      messages: 'id, chatId, state, nextAttemptAt, expireAt, lamport, readAt, [chatId+lamport], [chatId+state]',
      conversations: 'id, peerPubkey, lastMessageAt, unreadCount, [pinned+lastMessageAt]',
      processedEvents: 'id, receivedAt',
      syncState: 'id, relay, lastEventAt',
    })
  }
}

const dbName = () => 'v5-' + Math.random().toString(36).slice(2)

describe('v5 migration (files table)', () => {
  it('upgrades a v4 database and adds the files table without data loss', async () => {
    const name = dbName()
    const legacy = new LegacyDbV4(name)
    await legacy.open()
    await legacy.table('messages').bulkPut([
      { id: 'm1', chatId: 'c1', from: 'a', to: 'b', body: 'hello', ts: 1, lamport: 1, state: 'read', createdAt: 1, attempts: 0, nextAttemptAt: 0, direction: 'in' },
    ])
    legacy.close()

    const db = new TelepattyDb(name)
    await db.open()
    expect(db.verno).toBe(SCHEMA_VERSION)
    expect(db.verno).toBe(5)
    expect((await db.messages.get('m1'))?.body).toBe('hello')

    // files table usable
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' })
    await db.files.put({ id: 'f1', chatId: 'c1', messageId: 'm1', name: 'pic.png', mime: 'image/png', size: 3, blob, direction: 'in', createdAt: 1 })
    expect((await db.files.get('f1'))?.name).toBe('pic.png')
    db.close()
  })

  it('purges files with disappearing messages (mirrored expiry)', async () => {
    const db = new TelepattyDb(dbName())
    await db.open()
    const now = 1_000_000
    const clock = { now: () => now }
    const blob = new Blob([new Uint8Array([1])])
    await db.messages.bulkPut([
      { id: 'm-keep', chatId: 'c1', from: 'a', to: 'b', body: 'x', ts: 1, lamport: 1, state: 'read', createdAt: 1, attempts: 0, nextAttemptAt: 0, direction: 'in' },
      { id: 'm-expired', chatId: 'c1', from: 'a', to: 'b', body: 'photo', ts: 2, lamport: 2, state: 'read', createdAt: 2, attempts: 0, nextAttemptAt: 0, direction: 'in', expireAt: now - 1 },
    ])
    await db.files.bulkPut([
      { id: 'f-keep', chatId: 'c1', messageId: 'm-keep', name: 'k.bin', mime: 'application/octet-stream', size: 1, blob, direction: 'in', createdAt: 1 },
      { id: 'f-own-expiry', chatId: 'c1', name: 'e.bin', mime: 'application/octet-stream', size: 1, blob, direction: 'in', createdAt: 1, expireAt: now - 1 },
      { id: 'f-of-expired', chatId: 'c1', messageId: 'm-expired', name: 'o.bin', mime: 'application/octet-stream', size: 1, blob, direction: 'in', createdAt: 1 },
    ])
    await purgeExpired(db, clock)
    expect(await db.messages.get('m-expired')).toBeUndefined()
    expect(await db.messages.get('m-keep')).toBeDefined()
    expect(await db.files.get('f-keep')).toBeDefined()
    expect(await db.files.get('f-own-expiry')).toBeUndefined()
    expect(await db.files.get('f-of-expired')).toBeUndefined()
    db.close()
  })

  it('deleteConversation / clearChatHistory remove the chat files too', async () => {
    const { deleteConversation, clearChatHistory } = await import('./chat-store')
    const db = new TelepattyDb(dbName())
    await db.open()
    const blob = new Blob([new Uint8Array([1])])
    await db.files.bulkPut([
      { id: 'f1', chatId: 'c1', messageId: 'm1', name: 'a.bin', mime: 'application/octet-stream', size: 1, blob, direction: 'in', createdAt: 1 },
      { id: 'f2', chatId: 'c2', name: 'b.bin', mime: 'application/octet-stream', size: 1, blob, direction: 'in', createdAt: 1 },
    ])
    await clearChatHistory(db, 'c1')
    expect(await db.files.get('f1')).toBeUndefined()
    expect(await db.files.get('f2')).toBeDefined()
    await deleteConversation(db, 'c2')
    expect(await db.files.get('f2')).toBeUndefined()
    db.close()
  })
})
