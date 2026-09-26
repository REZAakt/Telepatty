import { describe, expect, it, vi } from 'vitest'
import { MessageRouter, nextLamport, observeLamport, receiptEnvelope } from './router'
import type { ReceiveHandler, Transport, SendResult } from './router'
import type { Envelope } from './protocol'
import { FakeClock } from './clock'

function fakeTransport(id: 'nostr' | 'webrtc', available: () => boolean): Transport {
  const cbs = new Set<ReceiveHandler>()
  return {
    id,
    send: async (env): Promise<SendResult> => (available() ? { ok: true } : { ok: false, error: 'down' }),
    onReceive: (cb) => {
      cbs.add(cb)
      return () => cbs.delete(cb)
    },
    status: () => (available() ? 'connected' : 'disconnected'),
    stop: () => {},
  }
}

const env = (type: Envelope['type'] = 'chat'): Envelope => ({
  id: 'x1',
  v: 1,
  type,
  from: 'a'.repeat(64),
  to: 'b'.repeat(64),
  ts: 1,
  lamport: 1,
})

describe('MessageRouter', () => {
  it('prefers WebRTC when connected, falls back to Nostr', async () => {
    const nostr = fakeTransport('nostr', () => true)
    let webrtcUp = false
    const webrtc = fakeTransport('webrtc', () => webrtcUp)
    const sent: string[] = []
    const spyNostr = vi.spyOn(nostr, 'send')
    const spyWeb = vi.spyOn(webrtc, 'send')

    const router = new MessageRouter((e) => (webrtcUp ? webrtc : nostr))
    router.register(nostr)
    router.register(webrtc)

    await router.send(env())
    expect(spyNostr).toHaveBeenCalledTimes(1)

    webrtcUp = true
    await router.send(env())
    expect(spyWeb).toHaveBeenCalledTimes(1)
    expect(spyNostr).toHaveBeenCalledTimes(1)
    void sent
  })

  it('routes signaling always via Nostr', async () => {
    const nostr = fakeTransport('nostr', () => true)
    const webrtc = fakeTransport('webrtc', () => true)
    const spyNostr = vi.spyOn(nostr, 'send')
    const spyWeb = vi.spyOn(webrtc, 'send')
    const router = new MessageRouter((e) => (e.type === 'signal' ? nostr : webrtc))
    router.register(nostr)
    router.register(webrtc)
    await router.send(env('signal'))
    expect(spyNostr).toHaveBeenCalledTimes(1)
    expect(spyWeb).not.toHaveBeenCalled()
  })

  it('forwards receives from all transports', () => {
    const pushers: ReceiveHandler[] = []
    const make = (id: 'nostr' | 'webrtc'): Transport => ({
      id,
      send: async () => ({ ok: true }),
      onReceive: (cb) => {
        pushers.push(cb)
        return () => void cb
      },
      status: () => 'connected',
      stop: () => {},
    })
    const router = new MessageRouter(() => make('nostr'))
    router.register(make('nostr'))
    router.register(make('webrtc'))
    const seen: string[] = []
    router.onReceive((e) => seen.push(e.id))
    for (const push of pushers) push(env(), { live: true })
    expect(seen).toEqual(['x1', 'x1'])
  })

  it('hands the transport\'s liveness verdict through to the subscriber', () => {
    const pushers: ReceiveHandler[] = []
    const make = (id: 'nostr' | 'webrtc'): Transport => ({
      id,
      send: async () => ({ ok: true }),
      onReceive: (cb) => {
        pushers.push(cb)
        return () => void cb
      },
      status: () => 'connected',
      stop: () => {},
    })
    const router = new MessageRouter(() => make('nostr'))
    router.register(make('nostr'))
    const seen: boolean[] = []
    router.onReceive((_e, meta) => seen.push(meta.live))
    // a relay replayed our stored mailbox (history), then pushed a fresh message
    pushers[0]!(env(), { live: false })
    pushers[0]!(env(), { live: true })
    expect(seen).toEqual([false, true])
  })
})

describe('lamport', () => {
  it('increments and observes', () => {
    const s = { last: 0 }
    expect(nextLamport(s)).toBe(1)
    expect(observeLamport(s, 5)).toBe(5)
    expect(nextLamport(s)).toBe(6)
  })
})

describe('receiptEnvelope', () => {
  it('builds a delivered receipt', () => {
    const clock = new FakeClock()
    const s = { last: 2 }
    const env = receiptEnvelope({ from: 'a'.repeat(64), to: 'b'.repeat(64), refId: 'm1', read: false }, clock, s)
    expect(env.type).toBe('receipt')
    expect(env.receipt).toBe('delivered')
    expect(env.refId).toBe('m1')
    expect(env.lamport).toBe(3)
  })
})
