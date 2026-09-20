import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeRelay, normalizeRelayUrl, type RelayWebSocket } from './relay-health'

/** Mock WebSocket controllable per test. */
function makeMockWs(mode: 'ok' | 'timeout' | 'error' | 'closed' | 'garbage') {
  const instances: MockWs[] = []

  class MockWs implements RelayWebSocket {
    readyState = 0
    onopen: ((ev?: unknown) => void) | null = null
    onmessage: ((ev: { data: unknown }) => void) | null = null
    onerror: ((ev?: unknown) => void) | null = null
    onclose: ((ev?: { code?: number }) => void) | null = null
    sent: string[] = []
    closedWith = 0
    constructor(public url: string) {
      instances.push(this)
      // real sockets fire onopen on connect — the probe only sends REQ after that
      setTimeout(() => this.onopen?.(), 5)
    }

    send(data: string): void {
      this.sent.push(data)
      if (mode === 'ok') {
        // REQ → EVENT(nothing needed) → EOSE round trip
        setTimeout(() => this.onmessage?.({ data: JSON.stringify(['EOSE', JSON.parse(data)[1]]) }), 5)
      } else if (mode === 'garbage') {
        setTimeout(() => this.onmessage?.({ data: 'not json' }), 5)
      } else if (mode === 'closed') {
        setTimeout(() => this.onclose?.({ code: 4003 }), 5)
      } else if (mode === 'error') {
        setTimeout(() => this.onerror?.(), 5)
      }
      // timeout: send nothing — the 9s timer must fire
    }
    close(code = 1000): void {
      this.closedWith = code
      this.readyState = 3
    }

  }
  return { ctor: MockWs as unknown as new (url: string) => RelayWebSocket, instances }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})


describe('normalizeRelayUrl', () => {
  it('canonically matches nostr-tools pool keys (adds trailing slash, strips hash)', () => {
    expect(normalizeRelayUrl('wss://nos.lol')).toBe('wss://nos.lol/')
    expect(normalizeRelayUrl('wss://relay.example/x#frag')).toBe('wss://relay.example/x')
    expect(normalizeRelayUrl('wss://relay.example/x')).toBe('wss://relay.example/x')
  })
})

describe('probeRelay (mocked WebSocket)', () => {
  it('reports ok with latency after REQ → EOSE round trip', async () => {
    const { ctor } = makeMockWs('ok')
    const res = await probeRelay('wss://good.example', { ws: ctor, timeoutMs: 2_000 })
    expect(res.ok).toBe(true)
    expect(res.latency).toBeGreaterThanOrEqual(0)
    expect(res.reason).toBeUndefined()
  })

  it('sends a REQ with an ephemeral subId and closes the socket (1000)', async () => {
    const { ctor, instances } = makeMockWs('ok')
    const res = await probeRelay('wss://good.example', { ws: ctor, timeoutMs: 2_000 })
    expect(res.ok).toBe(true)
    const ws = instances[0]!
    expect(ws.sent).toHaveLength(1)
    const req = JSON.parse(ws.sent[0]!) as unknown[]
    expect(req[0]).toBe('REQ')
    expect(String(req[1])).toMatch(/^tp/)
    expect(req[2]).toMatchObject({ limit: 1 })
    expect(ws.closedWith).toBe(1000)
  })

  it('times out when the relay never answers (premature-timeout regression: full window)', async () => {
    const { ctor } = makeMockWs('timeout')
    const res = await probeRelay('wss://slow.example', { ws: ctor, timeoutMs: 300 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('timeout')
  })

  it('reports concrete close code when relay drops the connection', async () => {
    const { ctor } = makeMockWs('closed')
    const res = await probeRelay('wss://auth.example', { ws: ctor, timeoutMs: 2_000 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('closed')
    expect(res.closeCode).toBe(4003)
  })

  it('reports error event as reason error', async () => {
    const { ctor } = makeMockWs('error')
    const res = await probeRelay('wss://blocked.example', { ws: ctor, timeoutMs: 2_000 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('error')
  })

  it('ignores malformed frames and keeps waiting for EOSE', async () => {
    const { ctor } = makeMockWs('garbage')
    const res = await probeRelay('wss://weird.example', { ws: ctor, timeoutMs: 2_000 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('timeout') // garbage ≠ EOSE → falls through to timeout
  })

  it('resolves unsupported when no WebSocket implementation exists', async () => {
    vi.stubGlobal('WebSocket', undefined)
    const res = await probeRelay('wss://x.example', {})
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('unsupported')
  })

})

