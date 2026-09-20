import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { TelepattyDb, SCHEMA_VERSION, MIGRATION_CHUNK } from './db'

/**
 * Regression: "TransactionInactiveError: Failed to execute 'openCursor' on
 * 'IDBObjectStore': The transaction is not active."
 *
 * A Dexie/IndexedDB upgrade runs inside ONE `versionchange` transaction. Real
 * IndexedDB (and fake-indexeddb) deactivate that transaction as soon as the
 * upgrade code yields to the event loop — e.g. by awaiting a *dynamic* `import()`
 * or any non-Dexie promise. The next cursor read then throws the error above and
 * the whole upgrade aborts, so the app can never open its database again.
 *
 * This file deliberately imports ONLY `./db` (never `./conversations` or
 * `./chat-store`), so the migration has to resolve its helper module for real —
 * exactly the cold-load path a browser takes on first page load.
 */

/** A plain v1 database: the schema shape Telepatty shipped before the upgrade. */
class LegacyDbV1 extends Dexie {
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
  }
}

const dbName = () => 'upgrade-' + Math.random().toString(36).slice(2)

describe('v4 upgrade transaction', () => {
  it('backfills conversation summaries without deactivating the upgrade transaction', async () => {
    const name = dbName()
    const legacy = new LegacyDbV1(name)
    await legacy.open()
    await legacy
      .table('messages')
      .bulkPut([
        { id: 'm1', chatId: 'c1', from: 'a', to: 'b', body: 'older', ts: 1, lamport: 1, state: 'read', createdAt: 1, attempts: 0, nextAttemptAt: 0, direction: 'in' },
        { id: 'm2', chatId: 'c1', from: 'a', to: 'b', body: 'newest body', ts: 2, lamport: 2, state: 'delivered', createdAt: 2, attempts: 0, nextAttemptAt: 0, direction: 'in' },
      ])
    legacy.close()

    const db = new TelepattyDb(name)
    // must not reject with TransactionInactiveError
    await db.open()
    expect(db.verno).toBe(SCHEMA_VERSION)

    const row = await db.conversations.get('c1')
    expect(row?.lastMessageId).toBe('m2')
    expect(row?.lastMessagePreview).toBe('newest body')
    expect(row?.unreadCount).toBe(1)
    db.close()
  })

  it('writes every chunk when the backfill crosses the MIGRATION_CHUNK boundary', async () => {
    // one message short of two full chunks, so both the mid-loop flush and the
    // trailing flush are exercised inside the same upgrade transaction
    const perChat = MIGRATION_CHUNK - 1
    const rows = [0, 1].flatMap((c) =>
      Array.from({ length: perChat }, (_, i) => {
        const lamport = i + 1
        return {
          id: `c${c}-m${lamport}`,
          chatId: `c${c}`,
          from: 'a',
          to: 'b',
          body: `body ${lamport}`,
          ts: lamport,
          lamport,
          state: lamport % 2 === 0 ? 'read' : 'delivered',
          createdAt: lamport,
          attempts: 0,
          nextAttemptAt: 0,
          direction: 'in',
        }
      }),
    )
    expect(rows.length).toBeGreaterThan(MIGRATION_CHUNK)

    const name = dbName()
    const legacy = new LegacyDbV1(name)
    await legacy.open()
    await legacy.table('messages').bulkPut(rows)
    legacy.close()

    const db = new TelepattyDb(name)
    await db.open()
    expect(await db.conversations.count()).toBe(2)

    for (const chatId of ['c0', 'c1']) {
      const summary = await db.conversations.get(chatId)
      expect(summary?.lastMessageId).toBe(`${chatId}-m${perChat}`)
      expect(summary?.lastLamport).toBe(perChat)
      expect(summary?.lastMessagePreview).toBe(`body ${perChat}`)
      expect(summary?.unreadCount).toBe(
        rows.filter((r) => r.chatId === chatId && r.direction === 'in' && r.state !== 'read').length,
      )
    }
    db.close()
  })
})
