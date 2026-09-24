import { describe, expect, it } from 'vitest'
import { generateIdentity, npubEncode, decodeKey, nsecEncode, bytesToHex, sealEnvelope, openWrap } from './crypto'
import { isSafeGiftWrap } from './nostr-transport'

import type { Envelope } from './protocol'
import { PROTOCOL_VERSION } from './protocol'

const env = (): Envelope => ({
  id: '0190aaaa-bbbb-7ccc-8ddd-eeeeffff0001',
  v: PROTOCOL_VERSION,
  type: 'chat',
  from: '',
  to: '',
  ts: Date.now(),
  lamport: 1,
  body: 'secret hello',
})

describe('NIP-59 sealing', () => {
  it('seals and opens round-trip', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const e = { ...env(), from: a.pk, to: b.pk }
    const wrap = sealEnvelope(e, a, b.pk)
    expect(wrap.kind).toBe(1059)
    const opened = openWrap(wrap, b.sk)
    expect(opened).not.toBeNull()
    expect(JSON.parse(opened!.content).body).toBe('secret hello')
    expect(opened!.rumor.pubkey).toBe(a.pk)
  })

  it('rejects the wrong recipient key', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const c = generateIdentity()
    const e = { ...env(), from: a.pk, to: b.pk }
    const wrap = sealEnvelope(e, a, b.pk)
    expect(openWrap(wrap, c.sk)).toBeNull()
  })

  it('rejects a tampered wrap', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const e = { ...env(), from: a.pk, to: b.pk }
    const wrap = sealEnvelope(e, a, b.pk)
    wrap.content = wrap.content.slice(0, -4) + 'AAAA'
    expect(openWrap(wrap, b.sk)).toBeNull()
  })

  it('adds NIP-40 expiration tag when requested', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const e = { ...env(), from: a.pk, to: b.pk }
    const expireAt = Date.now() + 86_400_000
    const wrap = sealEnvelope(e, a, b.pk, expireAt)
    expect(wrap.tags.some((t) => t[0] === 'expiration' && t[1] === String(Math.floor(expireAt / 1000)))).toBe(true)
    expect(openWrap(wrap, b.sk)).not.toBeNull()
  })

  it('rejects malformed or modified relay events before decryption', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const wrap = sealEnvelope({ ...env(), from: a.pk, to: b.pk }, a, b.pk)
    expect(isSafeGiftWrap(wrap)).toBe(true)
    expect(isSafeGiftWrap({ ...wrap, content: 'x'.repeat(160 * 1024 + 1) })).toBe(false)
    expect(isSafeGiftWrap({ ...wrap, sig: '0'.repeat(128) })).toBe(false)
  })
})

describe('key codecs', () => {
  it('npub/nsec/hex round trips', () => {
    const id = generateIdentity()
    const npub = npubEncode(id.pk)
    expect(npub.startsWith('npub1')).toBe(true)
    expect(bytesToHex(decodeKey(npub)!)).toBe(id.pk)
    const nsec = nsecEncode(id.sk)
    const backSk = decodeKey(nsec)!
    expect(backSk).toEqual(id.sk)
    expect(decodeKey('garbage')).toBeNull()
    // raw hex pubkey is also accepted as a friend code
    expect(bytesToHex(decodeKey(id.pk)!)).toBe(id.pk)
  })
})
