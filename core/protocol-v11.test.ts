import { describe, expect, it } from 'vitest'
import { parseEnvelope, serializeEnvelope } from './protocol'
import { toEnvelope, type Message } from './outbox'

const pkA = 'aa'.repeat(32)
const pkB = 'bb'.repeat(32)

function baseEnv(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    v: 1,
    type: 'chat',
    from: pkA,
    to: pkB,
    ts: 123,
    lamport: 4,
    body: 'hi',
    ...over,
  }
}

describe('v1.1 reply reference on the wire', () => {
  it('parses a well-formed replyTo object', () => {
    const res = parseEnvelope(baseEnv({ replyTo: { id: 'm9', senderPubkey: pkB, excerpt: 'quoted text' } }))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.env.replyTo).toEqual({ id: 'm9', senderPubkey: pkB, excerpt: 'quoted text' })
    }
  })

  it('drops an oversized/dirty excerpt but keeps the message', () => {
    const res = parseEnvelope(baseEnv({ replyTo: { id: 'm9', senderPubkey: pkB, excerpt: 'x'.repeat(500) } }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.env.replyTo?.excerpt.length).toBeLessThanOrEqual(120)
  })

  it('rejects an invalid pubkey in replyTo (message still parses)', () => {
    const res = parseEnvelope(baseEnv({ replyTo: { id: 'm9', senderPubkey: 'zz', excerpt: 'x' } }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.env.replyTo).toBeUndefined()
  })

  it('backward compatible: legacy STRING replyTo is dropped, envelope still parses', () => {
    const res = parseEnvelope(baseEnv({ replyTo: 'legacy-message-id' }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.env.replyTo).toBeUndefined()
  })

  it('older receivers (v1 parser semantics) ignore the object: unknown minor fields ride inside the E2EE envelope', () => {
    // the "update the app" guard must stay a MAJOR-version guard
    const newer = parseEnvelope(baseEnv({ v: 2 }))
    expect(newer).toEqual({ ok: false, reason: 'unsupported-version' })
    const same = parseEnvelope(baseEnv({ v: 1 }))
    expect(same.ok).toBe(true)
  })
})

describe('v1.1 file metadata on the wire', () => {
  const goodFile = {
    transferId: 't1',
    name: '  report.pdf ',
    mime: 'application/pdf',
    size: 1234,
    sha256: 'ab'.repeat(32),
    chunkSize: 16384,
  }

  it('parses and sanitises a file header', () => {
    const res = parseEnvelope(baseEnv({ file: goodFile }))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.env.file?.name).toBe('report.pdf') // trimmed by the name sanitiser
      expect(res.env.file?.size).toBe(1234)
    }
  })

  it('rejects oversize file offers at parse time (receiver cap)', () => {
    const res = parseEnvelope(baseEnv({ file: { ...goodFile, size: 5 * 1024 * 1024 + 1 } }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.env.file).toBeUndefined()
  })

  it('rejects garbage sha256 / chunkSize / name', () => {
    for (const bad of [
      { ...goodFile, sha256: 'nothex' },
      { ...goodFile, chunkSize: 0 },
      { ...goodFile, chunkSize: 2 * 1024 * 1024 },
      { ...goodFile, name: '' },
      { ...goodFile, transferId: '' },
    ]) {
      const res = parseEnvelope(baseEnv({ file: bad }))
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.env.file).toBeUndefined()
    }
  })

  it('caps inline thumbnails at ~16 KB and only image data URLs', () => {
    const big = 'data:image/webp;base64,' + 'A'.repeat(20_000)
    const res = parseEnvelope(baseEnv({ file: { ...goodFile, thumb: big } }))
    if (res.ok) expect(res.env.file?.thumb).toBeUndefined()
    const small = 'data:image/webp;base64,AAAA'
    const res2 = parseEnvelope(baseEnv({ file: { ...goodFile, thumb: small } }))
    if (res2.ok) expect(res2.env.file?.thumb).toBe(small)
  })

  it('parses a file ack and clamps its fields', () => {
    const res = parseEnvelope(baseEnv({ type: 'file_ack', fileAck: { transferId: 't1', accept: true, resumeFrom: 12.7 } }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.env.fileAck).toEqual({ transferId: 't1', accept: true, resumeFrom: 12 })
    const bad = parseEnvelope(baseEnv({ type: 'file_ack', fileAck: { nope: 1 } }))
    if (bad.ok) expect(bad.env.fileAck).toBeUndefined()
  })
})

describe('toEnvelope builds the v1.1 reply reference', () => {
  it('carries id + quoted sender + excerpt', () => {
    const msg: Message = {
      id: 'm1',
      chatId: pkB,
      from: pkA,
      to: pkB,
      body: 'my reply',
      replyTo: 'm0',
      replyExcerpt: 'their text',
      replyFrom: pkB,
      ts: 5,
      lamport: 2,
      state: 'pending',
      createdAt: 5,
      attempts: 0,
      nextAttemptAt: 0,
      direction: 'out',
    }
    const env = toEnvelope(msg)
    expect(env.replyTo).toEqual({ id: 'm0', senderPubkey: pkB, excerpt: 'their text' })
    expect(env.type).toBe('chat')
    expect(env.v).toBe(1)
  })

  it('round-trips through parseEnvelope', () => {
    const msg: Message = {
      id: 'm2',
      chatId: pkB,
      from: pkA,
      to: pkB,
      body: 're',
      replyTo: 'm0',
      replyExcerpt: 'q',
      replyFrom: pkB,
      ts: 6,
      lamport: 3,
      state: 'pending',
      createdAt: 6,
      attempts: 0,
      nextAttemptAt: 0,
      direction: 'out',
    }
    const res = parseEnvelope(serializeEnvelope(toEnvelope(msg)))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.env.replyTo?.id).toBe('m0')
  })
})
