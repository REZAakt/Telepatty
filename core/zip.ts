/**
 * Minimal client-side ZIP writer (STORE method, no compression).
 *
 * Why hand-rolled and dependency-free: multi-file attach needs a client-side
 * zip, but the total payload is already hard-capped at 5 MB, so compression
 * buys almost nothing next to the cost of a new runtime dependency. STORE
 * keeps the implementation tiny and CRC32 is the only checksum ZIP requires.
 * Output is a standard archive any unzip tool (and the receiver's browser)
 * can open.
 */
import { blobToDataUrl, dataUrlToBytes } from './files'

/** CRC-32 (IEEE 802.3), computed with a 256-entry table. */
let CRC_TABLE: Uint32Array | null = null

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

export function crc32(bytes: Uint8Array): number {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const U16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff]
const U32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

/** DOS date/time (local, 2-second resolution) from a unix timestamp. */
function dosDateTime(ts: number): { date: number; time: number } {
  const d = new Date(ts)
  const year = Math.max(1980, d.getFullYear())
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  return { date, time }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export interface ZipEntry {
  /** path inside the archive; sanitised to a flat basename by the caller */
  name: string
  data: Uint8Array
  /** modification time (unix ms) */
  ts?: number
}

/** Build a ZIP archive blob from entries (STORE, no compression). */
export function createZip(entries: ZipEntry[]): Blob {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name)
    const { date, time } = dosDateTime(entry.ts ?? Date.now())
    const crc = crc32(entry.data)
    const size = entry.data.length

    // local file header
    local.push(
      new Uint8Array([
        ...U32(0x04034b50),
        ...U16(20), // version needed
        ...U16(0x0800), // flags: UTF-8 names
        ...U16(0), // method: store
        ...U16(time),
        ...U16(date),
        ...U32(crc),
        ...U32(size),
        ...U32(size),
        ...U16(nameBytes.length),
        ...U16(0), // extra len
      ]),
      nameBytes,
      entry.data,
    )

    // central directory entry
    central.push(
      new Uint8Array([
        ...U32(0x02014b50),
        ...U16(20), // version made by
        ...U16(20), // version needed
        ...U16(0x0800),
        ...U16(0),
        ...U16(time),
        ...U16(date),
        ...U32(crc),
        ...U32(size),
        ...U32(size),
        ...U16(nameBytes.length),
        ...U16(0), // extra
        ...U16(0), // comment
        ...U16(0), // disk number
        ...U16(0), // internal attrs
        ...U32(0), // external attrs
        ...U32(offset),
      ]),
      nameBytes,
    )

    offset += 30 + nameBytes.length + size
  }

  const centralDir = concat(central)
  const end = new Uint8Array([
    ...U32(0x06054b50),
    ...U16(0),
    ...U16(0),
    ...U16(entries.length),
    ...U16(entries.length),
    ...U32(centralDir.length),
    ...U32(offset),
    ...U16(0),
  ])

  return new Blob([concat(local) as BlobPart, centralDir as BlobPart, end as BlobPart], { type: 'application/zip' })
}

/** Convenience: build a zip from File objects (reads them into memory). */
export async function zipFiles(files: File[]): Promise<Blob> {
  const entries: ZipEntry[] = []
  const seen = new Map<string, number>()
  for (const f of files) {
    // keep names unique inside the archive ("a.txt", "a (2).txt", …)
    const base = f.name || 'file'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const name = n === 1 ? base : base.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`)
    const buf = new Uint8Array(await f.arrayBuffer())
    entries.push({ name, data: buf, ts: f.lastModified })
  }
  return createZip(entries)
}

/** Round-trip helper used by tests (no runtime dependency on unzip tools). */
export async function zipToBytes(files: File[]): Promise<Uint8Array> {
  const blob = await zipFiles(files)
  return dataUrlToBytes(await blobToDataUrl(blob))
}