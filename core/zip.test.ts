import { describe, expect, it } from 'vitest'
import { crc32, createZip, zipToBytes } from './zip'
import { sanitizeFileName } from './files'

/** Minimal ZIP reader: walks local headers + central directory + EOCD. */
function readZip(bytes: Uint8Array): { name: string; size: number; crc: number; data: Uint8Array }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // locate EOCD from the end
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0)
  const count = dv.getUint16(eocd + 10, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  const out: { name: string; size: number; crc: number; data: Uint8Array }[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50)
    const crc = dv.getUint32(p + 16, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    // local header
    expect(dv.getUint32(localOffset, true)).toBe(0x04034b50)
    const lNameLen = dv.getUint16(localOffset + 26, true)
    const lExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    out.push({ name, size, crc, data: bytes.subarray(dataStart, dataStart + size) })
    p += 46 + nameLen
  }
  return out
}

describe('crc32', () => {
  it('matches known test vectors', () => {
    expect(crc32(new TextEncoder().encode(''))).toBe(0)
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('createZip', () => {
  it('produces a valid archive that round-trips entries', async () => {
    const a = new TextEncoder().encode('hello world')
    const b = new TextEncoder().encode('\u00f6\ufffd binary \u0001\u0002')
    const blob = createZip([
      { name: 'a.txt', data: a, ts: Date.UTC(2026, 0, 2, 3, 4, 5) },
      { name: 'b.bin', data: b },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const entries = readZip(bytes)
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.bin'])
    expect(new TextDecoder().decode(entries[0].data)).toBe('hello world')
    expect([...entries[1].data]).toEqual([...b])
    for (const e of entries) expect(crc32(e.data)).toBe(e.crc)
  })

  it('zipFiles keeps payloads byte-identical and names unique', async () => {
    const f1 = new File([new TextEncoder().encode('one')], 'same.txt')
    const f2 = new File([new TextEncoder().encode('two')], 'same.txt')
    const bytes = await zipToBytes([f1, f2])
    const entries = readZip(bytes)
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((e) => e.name)).size).toBe(2)
    expect(new TextDecoder().decode(entries[0].data)).toBe('one')
    expect(new TextDecoder().decode(entries[1].data)).toBe('two')
  })

  it('uses the 5 MB cap unit-compatible sizes (sanity: header overhead is tiny)', () => {
    const payload = new Uint8Array(1024)
    const blob = createZip([{ name: 'x', data: payload }])
    expect(blob.size).toBe(1024 + 30 + 1 + 46 + 1 + 22)
  })

  it('names are already sanitised by the caller convention (files.ts)', () => {
    expect(sanitizeFileName('../../evil\\path/name.txt')).toBe('name.txt')
  })
})
