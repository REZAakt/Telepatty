import { describe, expect, it } from 'vitest'
import { buildInviteLink, parseInvite, parseInviteQuery, RequestRateLimiter } from './invites'
import { generateIdentity, npubEncode } from './crypto'



describe('invites', () => {
  it('builds and parses an invite link', () => {
    const { pk } = generateIdentity()
    const link = buildInviteLink('https://user.github.io/telepatty', pk, 'Alice', ['wss://relay.example'])
    expect(link).toContain('#/add?')
    const res = parseInvite(link)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.invite.pubkey).toBe(pk)
      expect(res.invite.name).toBe('Alice')
      expect(res.invite.relays).toEqual(['wss://relay.example'])
    }
  })

  it('parses a bare friend code (npub or hex)', () => {
    const { pk } = generateIdentity()
    expect(parseInvite(npubEncode(pk))).toEqual({ ok: true, invite: { pubkey: pk } })
    expect(parseInvite(pk.toUpperCase())).toEqual({ ok: true, invite: { pubkey: pk } })
  })


  it('rejects invalid input', () => {
    expect(parseInvite('').ok).toBe(false)
    expect(parseInvite('hello').ok).toBe(false)
    expect(parseInvite('https://x.com/#/add?k=bad&v=1').ok).toBe(false)
    expect(parseInvite('https://x.com/#/add?k=' + 'a'.repeat(64) + '&v=2').ok).toBe(false)
    expect(parseInvite('https://x.com/profile').ok).toBe(false)
  })

  it('rate limits friend requests per key', () => {
    const rl = new RequestRateLimiter(60_000, 3)
    const now = 1_000
    expect(rl.allow('k1', now)).toBe(true)
    expect(rl.allow('k1', now + 1)).toBe(true)
    expect(rl.allow('k1', now + 2)).toBe(true)
    expect(rl.allow('k1', now + 3)).toBe(false)
    // window expiry resets
    expect(rl.allow('k1', now + 61_000)).toBe(true)
    // other keys unaffected
    expect(rl.allow('k2', now)).toBe(true)
  })

  it('caps friend requests across rotating sender keys', () => {
    const rl = new RequestRateLimiter(60_000, 5, 2)
    expect(rl.allow('key-1', 1_000)).toBe(true)
    expect(rl.allow('key-2', 1_001)).toBe(true)
    expect(rl.allow('key-3', 1_002)).toBe(false)
    expect(rl.allow('key-3', 62_000)).toBe(true)
  })

  describe('parseInviteQuery (internal /add route params)', () => {
    it('accepts missing v — the onboarding resume path pushes only k', () => {
      const { pk } = generateIdentity()
      const res = parseInviteQuery({ k: pk })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.invite.pubkey).toBe(pk)
    })

    it('regression: route params without v must NOT be invalid (friend page navigation)', () => {
      const { pk } = generateIdentity()
      const res = parseInviteQuery({ k: npubEncode(pk), n: 'Alice', r: 'wss://a.example,wss://b.example', v: '1' })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.invite.pubkey).toBe(pk)
        expect(res.invite.name).toBe('Alice')
        expect(res.invite.relays).toEqual(['wss://a.example', 'wss://b.example'])
      }
    })

    it('rejects wrong version and bad keys', () => {
      const { pk } = generateIdentity()
      expect(parseInviteQuery({ k: pk, v: '2' })).toEqual({ ok: false, reason: 'unsupported-version' })
      expect(parseInviteQuery({ k: 'garbage' })).toEqual({ ok: false, reason: 'invalid-key' })
      expect(parseInviteQuery({})).toEqual({ ok: false, reason: 'invalid-key' })
    })

    it('drops non-wss relay entries', () => {
      const { pk } = generateIdentity()
      const res = parseInviteQuery({ k: pk, r: 'http://nope,wss://good.example' })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.invite.relays).toEqual(['wss://good.example'])
    })
  })

})
