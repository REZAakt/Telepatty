/**
 * Wire protocol types shared by all transports.
 * Envelopes are transported inside NIP-59 gift-wrapped Nostr events (kind 14 rumor
 * whose content is the JSON envelope) or directly over a WebRTC DataChannel.
 */
import { sanitizeReplyRef } from './reply'
import { sanitizeFileName, MAX_FILE_BYTES } from './files'

export const PROTOCOL_VERSION = 1
/** Bound untrusted application payloads before they reach storage or WebRTC. */
export const MAX_ENVELOPE_BYTES = 64 * 1024
export const MAX_MESSAGE_BODY_CHARS = 32 * 1024
export const MAX_SIGNAL_SDP_CHARS = 64 * 1024
export const MAX_SIGNAL_CANDIDATE_BYTES = 8 * 1024

export type EnvelopeType =
  | 'chat'
  | 'friend_request'
  | 'friend_accept'
  | 'friend_decline'
  | 'receipt'
  | 'typing'
  | 'signal'
  | 'file'
  | 'file_ack'
  | 'file_cancel'

export type ReceiptKind = 'delivered' | 'read'

/** Quoted context for a reply (v1.1). Lives inside the E2EE envelope. */
export interface ReplyRef {
  id: string
  senderPubkey: string
  /** plain-text snippet, max ~120 chars, or a label like "Photo" */
  excerpt: string
}

/** Metadata header for a file transfer (v1.1). Bytes stream over WebRTC only. */
export interface FileMeta {
  transferId: string
  name: string
  mime: string
  size: number
  sha256: string
  chunkSize: number
  /** optional tiny preview (data URL, <= ~10 KB) for images */
  thumb?: string
}

/** Payload of `file_ack` / `file_cancel` envelopes. */
export interface FileAck {
  transferId: string
  /** receiver agrees to download (tap-to-download or auto-download) */
  accept?: boolean
  /** final verification result */
  ok?: boolean
  error?: string
  /** receiver-side resume point: highest contiguous chunk index received */
  resumeFrom?: number
}

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
  /** quoted message: { id, senderPubkey, excerpt } (v1.1, optional) */
  replyTo?: ReplyRef
  /** referenced message id (receipts) */
  refId?: string
  receipt?: ReceiptKind
  signal?: SignalPayload
  /** file-transfer metadata header (v1.1) */
  file?: FileMeta
  /** file transfer acknowledgement (v1.1) */
  fileAck?: FileAck
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
    if (new TextEncoder().encode(raw).byteLength > MAX_ENVELOPE_BYTES) return { ok: false, reason: 'invalid' }
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'invalid' }
  const e = obj as Record<string, unknown>
  const str = (x: unknown): x is string => typeof x === 'string'
  if (!str(e.id) || !e.id || e.id.length > 128) return { ok: false, reason: 'invalid' }
  if (typeof e.v !== 'number') return { ok: false, reason: 'invalid' }
  if (e.v > PROTOCOL_VERSION) return { ok: false, reason: 'unsupported-version' }
  if (!str(e.type)) return { ok: false, reason: 'invalid' }
  const KNOWN_TYPES: EnvelopeType[] = ['chat', 'friend_request', 'friend_accept', 'friend_decline', 'receipt', 'typing', 'signal', 'file', 'file_ack', 'file_cancel']
  if (!KNOWN_TYPES.includes(e.type as EnvelopeType)) return { ok: false, reason: 'invalid' }
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
  if (str(e.body)) {
    if (e.body.length > MAX_MESSAGE_BODY_CHARS) return { ok: false, reason: 'invalid' }
    env.body = e.body
  }
  // v1.1 reply reference: an object; legacy string replyTo from pre-1.1 senders
  // is silently dropped (backward compatible).
  const reply = sanitizeReplyRef(e.replyTo)
  if (reply) env.replyTo = reply
  if (str(e.refId)) env.refId = e.refId
  if (e.receipt === 'delivered' || e.receipt === 'read') env.receipt = e.receipt
  const signal = sanitizeSignal(e.signal)
  if (e.type === 'signal' && !signal) return { ok: false, reason: 'invalid' }
  if (signal) env.signal = signal
  const file = sanitizeFileMeta(e.file)
  if (file) env.file = file
  const fileAck = sanitizeFileAck(e.fileAck)
  if (fileAck) env.fileAck = fileAck
  if (typeof e.expireAt === 'number') env.expireAt = e.expireAt
  if (str(e.name) && e.name.length <= 64) env.name = e.name
  return { ok: true, env }
}

/** Reject oversized or malformed SDP/ICE before it reaches browser WebRTC APIs. */
function sanitizeSignal(raw: unknown): SignalPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const signal = raw as Record<string, unknown>
  if (signal.step !== 'offer' && signal.step !== 'answer' && signal.step !== 'ice' && signal.step !== 'bye') return undefined
  const out: SignalPayload = { step: signal.step }
  if (signal.step === 'offer' || signal.step === 'answer') {
    if (typeof signal.sdp !== 'string' || !signal.sdp || signal.sdp.length > MAX_SIGNAL_SDP_CHARS) return undefined
    out.sdp = signal.sdp
  }
  if (signal.step === 'ice') {
    if (!signal.candidate) return undefined
    try {
      if (new TextEncoder().encode(JSON.stringify(signal.candidate)).byteLength > MAX_SIGNAL_CANDIDATE_BYTES) return undefined
    } catch {
      return undefined
    }
    out.candidate = signal.candidate
  }
  return out
}

/** Validate a file metadata header (size cap, name sanitisation, sha256 shape). */
function sanitizeFileMeta(raw: unknown): FileMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const f = raw as Record<string, unknown>
  const str = (x: unknown): x is string => typeof x === 'string'
  const transferId = str(f.transferId) ? f.transferId.slice(0, 80) : ''
  const size = typeof f.size === 'number' && Number.isFinite(f.size) ? Math.floor(f.size) : -1
  const chunkSize = typeof f.chunkSize === 'number' && Number.isFinite(f.chunkSize) ? Math.floor(f.chunkSize) : 0
  const name = str(f.name) ? f.name.slice(0, 128) : ''
  const mime = str(f.mime) ? f.mime.slice(0, 128) : ''
  const sha = str(f.sha256) ? f.sha256.toLowerCase() : ''
  if (!transferId || size < 0 || size > MAX_FILE_BYTES) return undefined
  if (!name || !/^[0-9a-f]{64}$/.test(sha) || chunkSize <= 0 || chunkSize > 1024 * 1024) return undefined
  const meta: FileMeta = { transferId, name: sanitizeFileName(name), mime, size, sha256: sha, chunkSize }
  if (str(f.thumb) && f.thumb.startsWith('data:image/') && f.thumb.length <= 16 * 1024) meta.thumb = f.thumb
  return meta
}

/** Validate a file ack payload. */
function sanitizeFileAck(raw: unknown): FileAck | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const f = raw as Record<string, unknown>
  if (typeof f.transferId !== 'string' || !f.transferId) return undefined
  const ack: FileAck = { transferId: f.transferId.slice(0, 80) }
  if (f.accept === true) ack.accept = true
  if (f.ok === true) ack.ok = true
  if (typeof f.error === 'string') ack.error = f.error.slice(0, 64)
  if (typeof f.resumeFrom === 'number' && Number.isFinite(f.resumeFrom) && f.resumeFrom >= 0) {
    ack.resumeFrom = Math.floor(f.resumeFrom)
  }
  return ack
}

export function serializeEnvelope(env: Envelope): string {
  return JSON.stringify(env)
}
