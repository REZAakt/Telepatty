import type { Envelope } from './protocol'
import type { RequestRateLimiter } from './invites'

export interface ReceiveContext {
  friends: Set<string>
  outgoingPending: Set<string>
  blocked: Set<string>
  rateLimiter: RequestRateLimiter
  trafficLimiter: IncomingTrafficLimiter
  now: number
}

export type ReceiveVerdict =
  | { allow: true }
  | { allow: false; reason: 'blocked' | 'not-friend' | 'rate-limited' | 'not-to-me' | 'self' }

/** Bounds work from an already-authorized but abusive peer in this browser. */
export class IncomingTrafficLimiter {
  private entries = new Map<string, { n: number; first: number }>()
  constructor(private windowMs = 60_000, private maxPerSender = 120) {}

  allow(sender: string, now: number): boolean {
    const current = this.entries.get(sender)
    if (!current || now - current.first > this.windowMs) {
      this.entries.set(sender, { n: 1, first: now })
      return true
    }
    if (current.n >= this.maxPerSender) return false
    current.n += 1
    return true
  }
}

/**
 * Decide whether an incoming envelope may be processed.
 * Friend requests are the only exception to "friends only" and are rate limited.
 *
 * `friend_accept` — and chat traffic from someone you invited — is also allowed
 * while the sender is in `outgoingPending`: you sent them a request (you know
 * their pubkey from their invite), so their accept/message finalizes the
 * friendship. Without this, the accept lands *before* the friendship exists on
 * the requester's side and is dropped — the requester then stays "pending"
 * forever (and misses the first messages).
 */
export function validateIncoming(env: Envelope, me: string, ctx: ReceiveContext): ReceiveVerdict {
  if (env.to !== me) return { allow: false, reason: 'not-to-me' }
  if (env.from === me) return { allow: false, reason: 'self' }
  if (ctx.blocked.has(env.from)) return { allow: false, reason: 'blocked' }
  if (env.type === 'chat' || env.type === 'receipt' || env.type === 'typing' || env.type === 'friend_accept' || env.type === 'signal' || env.type === 'file_ack' || env.type === 'file_cancel') {
    const trusted = ctx.friends.has(env.from) || ctx.outgoingPending.has(env.from)
    if (!trusted) return { allow: false, reason: 'not-friend' }
    if (!ctx.trafficLimiter.allow(env.from, ctx.now)) return { allow: false, reason: 'rate-limited' }
    return { allow: true }
  }
  if (env.type === 'friend_request') {
    if (!ctx.rateLimiter.allow(env.from, ctx.now)) return { allow: false, reason: 'rate-limited' }
    return { allow: true }
  }
  if (env.type === 'friend_decline') {
    if (!ctx.outgoingPending.has(env.from)) return { allow: false, reason: 'not-friend' }
    return { allow: true }
  }
  return { allow: false, reason: 'not-friend' }
}

/** Stable display order for messages: Lamport, then sender ts, then id. */
export function compareMessages(a: { lamport: number; ts: number; id: string }, b: { lamport: number; ts: number; id: string }): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport
  if (a.ts !== b.ts) return a.ts - b.ts
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
