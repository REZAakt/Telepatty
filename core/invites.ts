import { bytesToHex, decodeKey, npubEncode } from './crypto'

export interface InviteData {
  pubkey: string
  name?: string
  relays?: string[]
}

/**
 * Build the invite link. Data lives ONLY in the URL fragment (`#/add?...`) so it
 * never reaches the web server (important on GitHub Pages).
 */
export function buildInviteLink(originAndBase: string, pubkey: string, name?: string, relays?: string[]): string {
  const p = new URLSearchParams()
  p.set('k', npubEncode(pubkey))
  if (name) p.set('n', name.slice(0, 64))
  if (relays?.length) p.set('r', relays.slice(0, 3).join(','))
  p.set('v', '1')
  return `${originAndBase.replace(/\/$/, '')}#/add?${p.toString()}`
}

/** Parse a full invite link, a raw `#/add?...` fragment, or a bare npub friend code. */
export function parseInvite(input: string): { ok: true; invite: InviteData } | { ok: false; reason: string } {
  const s = (input ?? '').trim()
  if (!s) return { ok: false, reason: 'empty' }
  // bare friend code
  if (!s.includes('#') && !s.startsWith('http')) {
    const bytes = decodeKey(s)
    if (!bytes) return { ok: false, reason: 'invalid-key' }
    return { ok: true, invite: { pubkey: bytesToHex(bytes) } }
  }
  const hashIdx = s.indexOf('#')
  if (hashIdx === -1) return { ok: false, reason: 'missing-fragment' }
  const frag = s.slice(hashIdx + 1)
  if (!frag.startsWith('/add?')) return { ok: false, reason: 'unknown-fragment' }
  const params = new URLSearchParams(frag.slice(5))
  if (params.get('v') !== '1') return { ok: false, reason: 'unsupported-version' }
  const bytes = decodeKey(params.get('k') ?? '')
  if (!bytes) return { ok: false, reason: 'invalid-key' }
  const relaysRaw = params.get('r')
  const relays = relaysRaw ? relaysRaw.split(',').filter((r) => /^wss:\/\/.+/.test(r)).slice(0, 3) : undefined
  const name = params.get('n') ?? undefined
  return { ok: true, invite: { pubkey: bytesToHex(bytes), name, relays } }
}

/** Parse invite data from route/query params (internal navigation; v is optional but must be ≤ 1). */
export function parseInviteQuery(q: Record<string, unknown>): { ok: true; invite: InviteData } | { ok: false; reason: string } {
  if (q.v !== undefined && q.v !== null && String(q.v) !== '1') return { ok: false, reason: 'unsupported-version' }
  const bytes = decodeKey(String(q.k ?? ''))
  if (!bytes) return { ok: false, reason: 'invalid-key' }
  const r = typeof q.r === 'string' ? q.r : undefined
  const relays = r
    ? r
        .split(',')
        .map((x) => x.trim())
        .filter((x) => /^wss:\/\/.+/.test(x))
        .slice(0, 3)
    : undefined
  const n = typeof q.n === 'string' ? q.n : undefined
  return { ok: true, invite: { pubkey: bytesToHex(bytes), name: n || undefined, relays } }
}

/** Rate limit incoming friend requests per public key. */

export class RequestRateLimiter {
  private entries = new Map<string, { n: number; first: number }>()
  constructor(private windowMs = 60 * 60_000, private max = 5) {}
  /** returns false when the key exceeded the allowed number of requests in the window */
  allow(key: string, now: number): boolean {
    const e = this.entries.get(key)
    if (!e || now - e.first > this.windowMs) {
      this.entries.set(key, { n: 1, first: now })
      return true
    }
    if (e.n >= this.max) return false
    e.n += 1
    return true
  }
}


