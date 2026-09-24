import { describe, expect, it } from 'vitest'
import { MAX_ENVELOPE_BYTES, parseEnvelope, serializeEnvelope, PROTOCOL_VERSION, type Envelope } from './protocol'

const base: Envelope = {
  id: '0190aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
  v: PROTOCOL_VERSION,
  type: 'chat',
  from: 'a'.repeat(64),
  to: 'b'.repeat(64),
  ts: 1_700_000_000_000,
  lamport: 3,
  body: 'hello',
}

describe('parseEnvelope', () => {
  it('round-trips a valid envelope', () => {
    const parsed = parseEnvelope(serializeEnvelope(base))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.env).toEqual(base)
  })

  it('accepts an object input', () => {
    expect(parseEnvelope(base).ok).toBe(true)
  })

  it('rejects garbage', () => {
    expect(parseEnvelope('not json').ok).toBe(false)
    expect(parseEnvelope(null).ok).toBe(false)
    expect(parseEnvelope({ ...base, from: 'zzz' }).ok).toBe(false)
    expect(parseEnvelope({ ...base, ts: 'x' }).ok).toBe(false)
    expect(parseEnvelope({ ...base, id: '' }).ok).toBe(false)
  })

  it('flags newer protocol versions instead of crashing', () => {
    const res = parseEnvelope({ ...base, v: PROTOCOL_VERSION + 1 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('unsupported-version')
  })

  it('rejects oversized message and signaling payloads', () => {
    expect(parseEnvelope({ ...base, body: 'x'.repeat(32 * 1024 + 1) }).ok).toBe(false)
    expect(parseEnvelope({ ...base, type: 'signal', signal: { step: 'offer', sdp: 'x'.repeat(64 * 1024 + 1) } }).ok).toBe(false)
    expect(parseEnvelope('x'.repeat(MAX_ENVELOPE_BYTES + 1)).ok).toBe(false)
  })

  it('requires structurally valid signaling', () => {
    expect(parseEnvelope({ ...base, type: 'signal' }).ok).toBe(false)
    expect(parseEnvelope({ ...base, type: 'signal', signal: { step: 'ice', candidate: { candidate: 'a'.repeat(9 * 1024) } } }).ok).toBe(false)
  })
})
