import { describe, expect, it } from 'vitest'
import { validateIncoming, compareMessages } from './receive'
import { RequestRateLimiter } from './invites'
import type { Envelope } from './protocol'

const me = 'f'.repeat(64)
const other = 'a'.repeat(64)

const ctx = (over: Partial<Parameters<typeof validateIncoming>[2]> = {}) => ({
  friends: new Set([other]),
  outgoingPending: new Set<string>(),
  blocked: new Set<string>(),
  rateLimiter: new RequestRateLimiter(60_000, 3),
  now: 1_000,
  ...over,
})

const env = (type: Envelope['type'], from = other): Envelope => ({
  id: 'e1',
  v: 1,
  type,
  from,
  to: me,
  ts: 1,
  lamport: 1,
})

describe('validateIncoming', () => {
  it('accepts chat from a friend', () => {
    expect(validateIncoming(env('chat'), me, ctx())).toEqual({ allow: true })
  })

  it('drops chat from strangers', () => {
    const stranger = 'b'.repeat(64)
    const res = validateIncoming(env('chat', stranger), me, ctx())
    expect(res).toEqual({ allow: false, reason: 'not-friend' })
  })

  it('silently drops blocked senders (even friend requests)', () => {
    expect(validateIncoming(env('chat'), me, ctx({ blocked: new Set([other]) })).allow).toBe(false)
    expect(validateIncoming(env('friend_request'), me, ctx({ blocked: new Set([other]) })).reason).toBe('blocked')
  })

  it('rate limits friend requests', () => {
    const rl = new RequestRateLimiter(60_000, 2)
    const c = ctx({ friends: new Set<string>(), rateLimiter: rl })
    expect(validateIncoming(env('friend_request'), me, c).allow).toBe(true)
    expect(validateIncoming(env('friend_request'), me, c).allow).toBe(true)
    expect(validateIncoming(env('friend_request'), me, c)).toEqual({ allow: false, reason: 'rate-limited' })
  })

  it('rejects wrong recipient and self messages', () => {
    const e = env('chat')
    e.to = 'c'.repeat(64)
    expect(validateIncoming(e, me, ctx()).reason).toBe('not-to-me')
    expect(validateIncoming(env('chat', me), me, ctx()).reason).toBe('self')
  })

  it('allows friend_decline only with pending outgoing request', () => {
    expect(validateIncoming(env('friend_decline'), me, ctx()).allow).toBe(false)
    expect(validateIncoming(env('friend_decline'), me, ctx({ outgoingPending: new Set([other]) })).allow).toBe(true)
  })

  it('allows friend_accept from a peer with a pending outgoing request (accept lands before friendship)', () => {
    expect(validateIncoming(env('friend_accept'), me, ctx({ friends: new Set<string>() })).allow).toBe(false)
    expect(validateIncoming(env('friend_accept'), me, ctx({ friends: new Set<string>(), outgoingPending: new Set([other]) })).allow).toBe(true)
  })

  it('allows chat from a peer we invited but had not marked as friend yet (heal path)', () => {
    const c = ctx({ friends: new Set<string>(), outgoingPending: new Set([other]) })
    expect(validateIncoming(env('chat'), me, c).allow).toBe(true)
  })

  it('still drops chat from a stranger (no friend, no pending request)', () => {
    const stranger = 'b'.repeat(64)
    expect(validateIncoming(env('chat', stranger), me, ctx({ friends: new Set<string>() })).reason).toBe('not-friend')
  })
})

describe('compareMessages', () => {
  it('orders by lamport, then ts, then id', () => {
    const a = { lamport: 1, ts: 5, id: 'a' }
    const b = { lamport: 2, ts: 1, id: 'b' }
    const c = { lamport: 2, ts: 1, id: 'c' }
    expect(compareMessages(a, b)).toBeLessThan(0)
    expect(compareMessages(b, c)).toBeLessThan(0)
    expect(compareMessages(b, { ...b })).toBe(0)
  })
})
