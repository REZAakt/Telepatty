import { describe, expect, it, beforeAll } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'

import { TelepattyDb } from './db'
import { purgeExpired } from './purge'
import { FakeClock } from './clock'

describe('purgeExpired', () => {
  it('deletes only expired messages', async () => {
    const db = new TelepattyDb('test-purge-' + Math.random().toString(36).slice(2))
    await db.open()
    const clock = new FakeClock(5_000)
    await db.messages.bulkPut([
      { id: 'p1', chatId: 'c1', from: 'a', to: 'b', body: 'gone', ts: 1, lamport: 1, state: 'delivered', createdAt: 1, attempts: 0, nextAttemptAt: 0, direction: 'in', expireAt: 4_000 },
      { id: 'p2', chatId: 'c1', from: 'a', to: 'b', body: 'stay', ts: 2, lamport: 2, state: 'delivered', createdAt: 2, attempts: 0, nextAttemptAt: 0, direction: 'in', expireAt: 9_000 },
      { id: 'p3', chatId: 'c1', from: 'a', to: 'b', body: 'forever', ts: 3, lamport: 3, state: 'delivered', createdAt: 3, attempts: 0, nextAttemptAt: 0, direction: 'in' },
    ])
    const n = await purgeExpired(db, clock)
    expect(n).toBe(1)
    expect(await db.messages.get('p1')).toBeUndefined()
    expect(await db.messages.get('p2')).toBeDefined()
    expect(await db.messages.get('p3')).toBeDefined()
    db.close()
  })
})

beforeAll(() => {
  Dexie.debug = false
})
