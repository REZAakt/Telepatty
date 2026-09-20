/** Real relay health probe: open a WebSocket, send REQ, await EOSE. */

export interface RelayProbeResult {
  ok: boolean
  /** failure reason for UI display */
  reason?: 'timeout' | 'error' | 'closed' | 'unsupported'
  closeCode?: number
  detail?: string
  latency?: number
}

export interface RelayWebSocket {
  readyState: number
  send(data: string): void
  close(code?: number): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev?: unknown) => void) | null
  onclose: ((ev?: { code?: number }) => void) | null
}

export type RelayWebSocketCtor = new (url: string) => RelayWebSocket

/** Canonical relay URL form used by nostr-tools pools (trailing slash, no hash). */
export function normalizeRelayUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Probe a relay with a real REQ → EOSE round trip.
 * Resolves within `timeoutMs` (default 9s) with a concrete failure reason.
 * Never throws; always closes the socket.
 */
export function probeRelay(url: string, opts: { timeoutMs?: number; ws?: RelayWebSocketCtor } = {}): Promise<RelayProbeResult> {
  const WSImpl = opts.ws ?? (globalThis as unknown as { WebSocket?: RelayWebSocketCtor }).WebSocket
  const timeoutMs = opts.timeoutMs ?? 9_000
  if (!WSImpl) return Promise.resolve({ ok: false, reason: 'unsupported' })

  return new Promise((resolve) => {
    let settled = false
    let ws: RelayWebSocket | undefined
    let subId = ''
    const t0 = Date.now()

    const finish = (r: RelayProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws?.close(1000)
      } catch {
        /* already closed */
      }
      resolve(r)
    }

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs)

    try {
      ws = new WSImpl(url)
    } catch (e) {
      finish({ ok: false, reason: 'error', detail: String(e) })
      return
    }

    subId = 'tp' + Math.random().toString(36).slice(2, 10)

    ws.onopen = () => {
      try {
        // filter that matches nothing → relays answer with EOSE right away
        ws?.send(JSON.stringify(['REQ', subId, { kinds: [99999999], limit: 1 }]))
      } catch {
        /* ignore */
      }
    }
    ws.onmessage = (ev) => {
      try {
        const arr = JSON.parse(String(ev.data)) as unknown[]
        if (Array.isArray(arr) && arr[0] === 'EOSE' && arr[1] === subId) {
          finish({ ok: true, latency: Date.now() - t0 })
        }
        // NOTICE / EVENT / AUTH etc. are ignored — we only trust our EOSE
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onerror = () => finish({ ok: false, reason: 'error' })
    ws.onclose = (ev) => finish({ ok: false, reason: 'closed', closeCode: ev?.code })
  })
}
