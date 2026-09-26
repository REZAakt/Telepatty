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

/**
 * How an envelope reached us — the difference between "someone is writing to you
 * right now" and "a relay replayed the mailbox you missed while you were away".
 *
 * `live: true`  → pushed on an open connection (peer data channel, or a relay
 *                 push after it finished replaying our stored mailbox). The user
 *                 is here, so it may ring/toast.
 * `live: false` → relay backlog: it was published while the app was closed or
 *                 offline. Unread counters and the chat list still update, but
 *                 nothing steals attention (no sound, no toast, no system
 *                 notification).
 */
export interface ReceiveMeta {
  live: boolean
}

export type ReceiveHandler = (envelope: Envelope, meta: ReceiveMeta) => void

export interface Transport {
  id: TransportId
  send(envelope: Envelope): Promise<SendResult>
  onReceive(cb: ReceiveHandler): () => void
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
  private receiveCbs = new Set<ReceiveHandler>()
  private transports: Transport[] = []

  constructor(private picker: TransportPicker) {}

  register(t: Transport): void {
    this.transports.push(t)
    t.onReceive((env, meta) => {
      for (const cb of this.receiveCbs) cb(env, meta)
    })
  }

  async send(env: Envelope): Promise<SendResult> {
    const t = this.picker(env)
    if (!t) return { ok: false, error: 'no-transport' }
    return t.send(env)
  }

  onReceive(cb: ReceiveHandler): () => void {
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
