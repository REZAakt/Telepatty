import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessageRow } from '~~/core/db'
import { TelepattyDb } from '~~/core/db'
import { FakeClock } from '~~/core/clock'
import { putMessage } from '~~/core/chat-store'
import { onBus, resetBus } from '~~/core/bus'
import { FileTransferManager, type OutboxMessageLike } from './file-transfer-manager'

/**
 * Regression test for the reported "my own photo/file bubble shows NOTHING until
 * I reload the page" bug.
 *
 * The open chat renders a bubble straight from the `message` bus event and
 * resolves the blob URL (and sniffs the image) immediately, so the message row
 * carrying `fileId` must not be announced before the bytes are in the `files`
 * table. This test runs the REAL manager with the REAL outbox wiring (an
 * `enqueue` that persists through `putMessage`, exactly like `messenger.ts`
 * does) and asserts that the blob is already readable when the file message is
 * announced.
 */
async function harness() {
  const db = new TelepattyDb('ft-' + Math.random().toString(36).slice(2))
  await db.open()
  const events: string[] = []
  const announced: Promise<boolean>[] = []
  const offs = [
    onBus('message', (row) => {
      events.push(row.fileId ? 'message(fileId)' : 'message')
      // what the bubble does the moment it receives the row
      if (row.fileId) announced.push(db.files.get(row.fileId).then((f) => !!f))
    }),
    onBus('file-stored', () => events.push('file-stored')),
    onBus('file-failed', () => events.push('file-failed')),
  ]
  const manager = new FileTransferManager({
    db,
    clock: new FakeClock(),
    lamport: { last: 0 },
    myPk: () => 'me',
    send: async () => true,
    isDirect: () => true,
    rawSend: () => true,
    onChannelOpen: () => undefined,
    onBufferLow: () => undefined,
    onRawFrame: () => undefined,
    autoDownloadImages: () => true,
    isFriend: () => true,
  })
  /** mirrors the outbox wiring in `messenger.ts`: `enqueue` persists the row */
  const enqueue = async (m: OutboxMessageLike) => {
    await putMessage(
      db,
      { ...m, state: 'pending', createdAt: 0, attempts: 0, nextAttemptAt: 0, direction: 'out' } as ChatMessageRow,
      { countUnread: false },
    )
    return { id: m.id, ts: m.ts, lamport: m.lamport }
  }
  const send = (mime = 'image/png') => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: mime })
    return manager.send({
      chatId: 'peer',
      blob,
      name: 'photo.png',
      mime,
      size: blob.size,
      sha256: 'a'.repeat(64),
      enqueue,
    })
  }
  const dispose = () => {
    for (const off of offs) off()
    db.close()
    resetBus()
  }
  return { db, events, announced, send, dispose, manager }
}

describe('file messages are announced only once their bytes are stored', () => {
  it('the blob is readable when the message row reaches the open chat', async () => {
    const h = await harness()
    const res = await h.send()
    expect(res).not.toBeNull()

    // ← this was `[false]` before the fix: the bubble asked for the blob before
    //   it existed, and never asked again (hence "nothing until I refresh")
    expect(await Promise.all(h.announced)).toEqual([true])

    // the pipeline order is pinned, not just the outcome
    expect(h.events).toEqual(['message', 'file-stored', 'message(fileId)'])
    h.dispose()
  })

  it('message row and blob row point at each other (so a reload and a live bubble agree)', async () => {
    const h = await harness()
    const res = await h.send('application/pdf')
    const row = await h.db.messages.get(res!.id)

    expect(row?.kind).toBe('file')
    expect(row?.fileMeta?.name).toBe('photo.png')
    expect(row?.fileId).toBe(res!.transferId)
    expect(await h.db.files.get(res!.transferId)).toBeTruthy()
    h.dispose()
  })

  it('a storage failure keeps the failure visible and still reports quota', async () => {
    const h = await harness()
    vi.spyOn(h.db.files, 'put').mockRejectedValue(new Error('QuotaExceededError'))

    await expect(h.send()).rejects.toThrow('quota')

    expect(h.events).toEqual(['message', 'message(fileId)', 'file-failed'])
    const rows = await h.db.messages.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.fileId).toBe(rows[0]?.id)
    h.dispose()
  })
})
