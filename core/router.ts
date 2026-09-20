import type { Envelope } from './protocol'
import type { Clock } from './clock'
import { newId } from './ids'

export type TransportId = 'webrtc' | 'nostr'

export interface SendResult {
  ok: boolean
  /** transport-specific error reason for user display */
  error?: string
}

export type TransportStatus = 'disconnected' | 'connecting' | 'connected'

export interface Transport {
  id: TransportId
  send(envelope: Envelope): Promise<SendResult>
  onReceive(cb: (envelope: Envelope) => void): () => void
  status(): TransportStatus
  /** release connections/timers */
  stop(): void
}

export type TransportPicker = (env: Envelope) => Transport | undefined

/**
 * MessageRouter: picks a transport per envelope and forwards receives upward.
 * Adding/replacing transports never touches UI code.
 */
export class MessageRouter {
  private receiveCbs = new Set<(env: Envelope) => void>()
  private transports: Transport[] = []

  constructor(private picker: TransportPicker) {}

  register(t: Transport): void {
    this.transports.push(t)
    t.onReceive((env) => {
      for (const cb of this.receiveCbs) cb(env)
    })
  }

  async send(env: Envelope): Promise<SendResult> {
    const t = this.picker(env)
    if (!t) return { ok: false, error: 'no-transport' }
    return t.send(env)
  }

  onReceive(cb: (env: Envelope) => void): () => void {
    this.receiveCbs.add(cb)
    return () => this.receiveCbs.delete(cb)
  }

  status(): Record<TransportId, TransportStatus> {
    return Object.fromEntries(this.transports.map((t) => [t.id, t.status()])) as Record<TransportId, TransportStatus>
  }

  stopAll(): void {
    for (const t of this.transports) t.stop()
    this.transports = []
    this.receiveCbs.clear()
  }
}

/** Helpers for per-conversation Lamport counters. */
export interface LamportState {
  last: number
}

export function nextLamport(state: LamportState): number {
  state.last += 1
  return state.last
}

export function observeLamport(state: LamportState, incoming: number): number {
  state.last = Math.max(state.last, incoming)
  return state.last
}

/** Build a receipt envelope. */
export function receiptEnvelope(base: { from: string; to: string; refId: string; read: boolean }, clock: Clock, state: LamportState): Envelope {
  return {
    id: newId(),
    v: 1,
    type: 'receipt',
    from: base.from,
    to: base.to,
    ts: clock.now(),
    lamport: nextLamport(state),
    refId: base.refId,
    receipt: base.read ? 'read' : 'delivered',
  }
}
