import { describe, expect, it, beforeEach } from 'vitest'
import { Outbox } from './outbox'
import type { Message } from './outbox'
import { FakeClock } from './clock'

interface MemState {
  store: Map<string, Message>
  sent: string[]
}

function makeOutbox(mem: MemState, fail: (msg: Message) => boolean) {
  const clock = new FakeClock()
  const outbox = new Outbox({
    clock,
    send: async (msg) => !fail(msg),
    onStateChange: () => {},
    save: async (msg) => void mem.store.set(msg.id, { ...msg }),
    remove: async (id) => void mem.store.delete(id),
    get: async (id) => (mem.store.has(id) ? { ...mem.store.get(id)! } : undefined),
    due: async (now) => [...mem.store.values()].filter((m) => m.state === 'pending' && m.nextAttemptAt <= now).map((m) => ({ ...m })),
    nextAttemptAt: async () => {
      const pend = [...mem.store.values()].filter((m) => m.state === 'pending').map((m) => m.nextAttemptAt)
      return pend.length ? Math.min(...pend) : null
    },
  })
  return { outbox, clock }
}

const draft = {
  chatId: 'b'.repeat(64),
  from: 'a'.repeat(64),
  to: 'b'.repeat(64),
  body: 'hi',
  ts: 1_700_000_000_000,
  lamport: 1,
}

describe('Outbox', () => {
  let mem: MemState
  beforeEach(() => {
    mem = { store: new Map(), sent: [] }
  })

  it('sends immediately and marks sent', async () => {
    const { outbox } = makeOutbox(mem, () => false)
    const msg = await outbox.enqueue(draft)
    expect(msg.state).toBe('pending')
    await outbox.process()
    expect(mem.store.get(msg.id)!.state).toBe('sent')
  })

  it('retries with exponential backoff and eventually fails', async () => {
    let calls = 0
    const { outbox, clock } = makeOutbox(mem, () => {
      calls++
      return true // "fail"
    })
    const msg = await outbox.enqueue(draft)
    for (let i = 0; i < 10; i++) {
      await outbox.process()
      clock.advance(10 * 60_000) // jump past any backoff
    }
    expect(calls).toBeGreaterThanOrEqual(8)
    expect(mem.store.get(msg.id)!.state).toBe('failed')
    expect(mem.store.get(msg.id)!.attempts).toBeGreaterThanOrEqual(8)
  })

  it('keeps the entry until delivered; ack completes it', async () => {
    const { outbox, clock } = makeOutbox(mem, () => false)
    const msg = await outbox.enqueue(draft)
    await outbox.process()
    expect(mem.store.has(msg.id)).toBe(true) // still queued after 'sent'
    await outbox.ack(msg.id)
    expect(mem.store.get(msg.id)!.state).toBe('delivered')
    await outbox.complete(msg.id)
    expect(mem.store.has(msg.id)).toBe(false)
    clock.advance(1)
  })

  it('read receipt marks read', async () => {
    const { outbox } = makeOutbox(mem, () => false)
    const msg = await outbox.enqueue(draft)
    await outbox.process()
    await outbox.ack(msg.id, true)
    expect(mem.store.get(msg.id)!.state).toBe('read')
  })

  it('retryFailed resets attempts and state', async () => {
    const { outbox, clock } = makeOutbox(mem, () => true)
    const msg = await outbox.enqueue(draft)
    for (let i = 0; i < 9; i++) {
      await outbox.process()
      clock.advance(10 * 60_000)
    }
    expect(mem.store.get(msg.id)!.state).toBe('failed')
    await outbox.retryFailed(msg.id)
    expect(mem.store.get(msg.id)!.state).toBe('pending')
    expect(mem.store.get(msg.id)!.attempts).toBe(0)
  })

  it('never duplicates ids', async () => {
    const { outbox } = makeOutbox(mem, () => false)
    const a = await outbox.enqueue(draft)
    const b = await outbox.enqueue(draft)
    expect(a.id).not.toBe(b.id)
  })
})
