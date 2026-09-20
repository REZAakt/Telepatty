/**
 * File transfer state machine (pure, transport-agnostic, unit-testable).
 *
 * - The tiny `file` metadata ENVELOPE rides the normal MessageRouter (Nostr or
 *   DataChannel) and is E2EE like every other envelope.
 * - The raw BYTES stream over the direct WebRTC DataChannel only, as small
 *   JSON frames with a base64 payload (per-chunk index). They are NOT nostr
 *   events — relays never see file bytes.
 * - Backpressure: the pump stops while the channel's bufferedAmount is above
 *   the low watermark and resumes on `bufferedamountlow` (messenger wires it).
 * - Resume: the receiver ACKs its highest CONTIGUOUS chunk index; a restarted
 *   sender continues from there.
 * - Integrity: receiver verifies size + SHA-256 before storing / ACKing ok.
 */
import { FILE_CHUNK_BYTES, MAX_FILE_BYTES, chunkCountFor, sha256Hex } from './files'
import type { FileAck, FileMeta } from './protocol'

/** Raw DataChannel frame for one chunk. */
export interface ChunkFrame {
  /** marker so the transport can route file frames away from envelopes */
  tpFile: 1
  transferId: string
  i: number
  /** base64 chunk payload */
  d: string
}

const CHUNK_MARKER = 'tpFile'

export function isFileFrame(raw: string): boolean {
  // cheap pre-filter before JSON.parse: marker key must appear
  return raw.includes(CHUNK_MARKER)
}

export function encodeChunkFrame(transferId: string, i: number, bytes: Uint8Array): string {
  let binary = ''
  const SLICE = 0x8000
  for (let o = 0; o < bytes.length; o += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(o, o + SLICE))
  }
  const frame: ChunkFrame = { tpFile: 1, transferId, i, d: btoa(binary) }
  return JSON.stringify(frame)
}

export function decodeChunkFrame(raw: string): ChunkFrame | null {
  try {
    const f = JSON.parse(raw) as ChunkFrame
    if (f && f.tpFile === 1 && typeof f.transferId === 'string' && typeof f.i === 'number' && typeof f.d === 'string') return f
    return null
  } catch {
    return null
  }
}

export function chunkFrameBytes(frame: ChunkFrame): Uint8Array {
  return Uint8Array.from(atob(frame.d), (c) => c.charCodeAt(0))
}

/* ------------------------------------------------------------------ */
/* Sender                                                              */
/* ------------------------------------------------------------------ */

export interface SenderChannel {
  /** false → channel closed or full; the pump stops and waits for drain/ack */
  sendChunk(transferId: string, i: number, bytes: Uint8Array): boolean
  /** true while the channel is open and bufferedAmount is below the watermark */
  canSend(): boolean
}

export interface FileSenderOpts {
  meta: FileMeta
  bytes: Uint8Array
  channel: SenderChannel
  onProgress?: (sent: number, total: number) => void
  onDone?: () => void
  /** called when the peer cancelled or verification failed on their side */
  onAborted?: (reason: string) => void
}

export class FileSender {
  readonly total: number
  private sent = 0
  private confirmed = 0
  private cancelled = false
  private done = false

  constructor(private opts: FileSenderOpts) {
    this.total = chunkCountFor(opts.meta.size, opts.meta.chunkSize)
  }

  /** Stream as much as backpressure allows. Call again on drain/ack/open. */
  pump(): void {
    if (this.cancelled || this.done) return
    const meta = this.opts.meta
    while (this.sent < this.total && this.opts.channel.canSend()) {
      const start = this.sent * meta.chunkSize
      const slice = this.opts.bytes.subarray(start, Math.min(start + meta.chunkSize, meta.size))
      if (!this.opts.channel.sendChunk(meta.transferId, this.sent, slice)) break
      this.sent += 1
      this.opts.onProgress?.(this.sent, this.total)
    }
    if (this.sent >= this.total && this.confirmed >= this.total - 1) this.finish()
  }

  /** Handle a `file_ack` envelope: accept / progress / final result / resume. */
  onAck(ack: FileAck): void {
    if (ack.transferId !== this.opts.meta.transferId) return
    if (this.cancelled) return
    if (ack.error) {
      this.cancelled = true
      this.opts.onAborted?.(ack.error)
      return
    }
    if (ack.resumeFrom !== undefined && ack.resumeFrom > this.confirmed) {
      this.confirmed = Math.min(ack.resumeFrom, this.total - 1)
      if (this.sent <= this.confirmed) this.sent = this.confirmed + 1
    }
    if (ack.ok) {
      this.finish()
      return
    }
    this.pump()
  }

  /** Peer/channel restart: continue from the peer's confirmed index. */
  resume(): void {
    if (this.sent > this.confirmed + 1) this.sent = this.confirmed
    this.pump()
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    this.opts.onDone?.()
  }

  cancel(): void {
    this.cancelled = true
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  get sentCount(): number {
    return this.sent
  }

  get confirmedCount(): number {
    return this.confirmed
  }
}


/* ------------------------------------------------------------------ */
/* Receiver                                                            */
/* ------------------------------------------------------------------ */

export type ChunkVerdict =
  | { complete: false; contiguous: number }
  | { complete: true; bytes: Uint8Array }
  | { complete: false; rejected: 'index' | 'size' }

export class FileReceiver {
  readonly total: number
  private parts = new Map<number, Uint8Array>()
  private contiguous = -1
  private received = 0
  private finished = false

  constructor(public readonly meta: FileMeta) {
    this.total = chunkCountFor(meta.size, meta.chunkSize)
  }

  /** Highest contiguous chunk index received (ACK resume point), -1 when none. */
  get contiguousIndex(): number {
    return this.contiguous
  }

  get receivedCount(): number {
    return this.received
  }

  onChunk(i: number, bytes: Uint8Array): ChunkVerdict {
    if (this.finished) return { complete: false, contiguous: this.contiguous }
    if (i < 0 || i >= this.total) return { complete: false, rejected: 'index' }
    if (bytes.length > this.meta.chunkSize) return { complete: false, rejected: 'size' }
    if (!this.parts.has(i)) {
      this.parts.set(i, bytes)
      this.received += 1
    }
    // advance the contiguous pointer over completed prefixes
    let next = this.contiguous + 1
    while (this.parts.has(next)) next += 1
    this.contiguous = next - 1
    if (this.contiguous >= this.total - 1) {
      this.finished = true
      const all = new Uint8Array(this.meta.size)
      let offset = 0
      for (let k = 0; k < this.total; k++) {
        const part = this.parts.get(k)!
        all.set(part, offset)
        offset += part.length
      }
      return { complete: true, bytes: all }
    }
    return { complete: false, contiguous: this.contiguous }
  }

  /** Progress 0..1 (contiguous prefix / total). */
  get progress(): number {
    return this.total ? (this.contiguous + 1) / this.total : 1
  }
}

/** Receiver-side verification: exact size + SHA-256 match, or a rejection. */
export async function verifyTransfer(
  bytes: Uint8Array,
  meta: FileMeta,
): Promise<{ ok: true } | { ok: false; reason: 'size' | 'hash' }> {
  if (bytes.length !== meta.size || meta.size > MAX_FILE_BYTES) return { ok: false, reason: 'size' }
  const digest = await sha256Hex(bytes)
  if (digest !== meta.sha256) return { ok: false, reason: 'hash' }
  return { ok: true }
}

/** How often (in chunks) the receiver should emit a progress ACK. */
export const ACK_EVERY_CHUNKS = 16

/** Should the receiver ACK now? (contiguous progress / final result) */
export function shouldAckNow(lastAcked: number, contiguous: number, chunkCount: number): boolean {
  if (contiguous >= chunkCount - 1) return true
  return contiguous - lastAcked >= ACK_EVERY_CHUNKS
}

export const DEFAULT_CHUNK_SIZE = FILE_CHUNK_BYTES
