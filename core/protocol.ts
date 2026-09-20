/**
 * Wire protocol types shared by all transports.
 * Envelopes are transported inside NIP-59 gift-wrapped Nostr events (kind 14 rumor
 * whose content is the JSON envelope) or directly over a WebRTC DataChannel.
 */

export const PROTOCOL_VERSION = 1

export type EnvelopeType =
  | 'chat'
  | 'friend_request'
  | 'friend_accept'
  | 'friend_decline'
  | 'receipt'
  | 'typing'
  | 'signal'

export type ReceiptKind = 'delivered' | 'read'

export interface SignalPayload {
  /** WebRTC signaling step */
  step: 'offer' | 'answer' | 'ice' | 'bye'
  sdp?: string
  candidate?: unknown
}

export interface Envelope {
  /** unique id — duplicates are ignored (idempotent receive) */
  id: string
  /** protocol version; newer versions are never parsed, user is asked to update */
  v: number
  type: EnvelopeType
  /** sender public key (hex) */
  from: string
  /** recipient public key (hex) */
  to: string
  /** sender wall-clock timestamp (untrusted, ordering aid only) */
  ts: number
  /** per-conversation Lamport counter for stable ordering under clock skew */
  lamport: number
  /** chat message text */
  body?: string
  /** message id being replied to */
  replyTo?: string
  /** referenced message id (receipts) */
  refId?: string
  receipt?: ReceiptKind
  signal?: SignalPayload
  /** local deletion timestamp for disappearing messages (NIP-40 tag too) */
  expireAt?: number
  /** display name label carried by friend requests / accepts (unverified) */
  name?: string
}

export type ParseResult =
  | { ok: true; env: Envelope }
  | { ok: false; reason: 'invalid' | 'unsupported-version' }

/** Parse and structurally validate an envelope. Never throws. */
export function parseEnvelope(raw: unknown): ParseResult {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'invalid' }
  const e = obj as Record<string, unknown>
  const str = (x: unknown): x is string => typeof x === 'string'
  if (!str(e.id) || !e.id) return { ok: false, reason: 'invalid' }
  if (typeof e.v !== 'number') return { ok: false, reason: 'invalid' }
  if (e.v > PROTOCOL_VERSION) return { ok: false, reason: 'unsupported-version' }
  if (!str(e.type)) return { ok: false, reason: 'invalid' }
  if (!str(e.from) || !/^[0-9a-f]{64}$/.test(e.from)) return { ok: false, reason: 'invalid' }
  if (!str(e.to) || !/^[0-9a-f]{64}$/.test(e.to)) return { ok: false, reason: 'invalid' }
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return { ok: false, reason: 'invalid' }
  if (typeof e.lamport !== 'number' || !Number.isFinite(e.lamport)) return { ok: false, reason: 'invalid' }
  const env: Envelope = {
    id: e.id,
    v: e.v,
    type: e.type as EnvelopeType,
    from: e.from,
    to: e.to,
    ts: e.ts,
    lamport: e.lamport,
  }
  if (str(e.body)) env.body = e.body
  if (str(e.replyTo)) env.replyTo = e.replyTo
  if (str(e.refId)) env.refId = e.refId
  if (e.receipt === 'delivered' || e.receipt === 'read') env.receipt = e.receipt
  if (e.signal && typeof e.signal === 'object') env.signal = e.signal as SignalPayload
  if (typeof e.expireAt === 'number') env.expireAt = e.expireAt
  if (str(e.name) && e.name.length <= 64) env.name = e.name
  return { ok: true, env }
}

export function serializeEnvelope(env: Envelope): string {
  return JSON.stringify(env)
}
