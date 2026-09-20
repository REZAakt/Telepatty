/**
 * File sharing limits and pure helpers.
 *
 * HONEST DESIGN CONSTRAINT: public Nostr relays are NOT file storage (event
 * caps are tens of KB up to ~1 MB, retention and rate limits vary). Files are
 * therefore NEVER chunked across relay events — bytes move only over the
 * direct WebRTC DataChannel, while a tiny metadata envelope may ride the
 * normal message pipeline. See DECISIONS.md.
 */

/** Hard limit for one file, enforced on send AND on receive. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024
/** DataChannel chunk size for streaming. */
export const FILE_CHUNK_BYTES = 16 * 1024
/** DataChannel backpressure thresholds (bufferedAmount). */
export const BUFFER_LOW_WATERMARK = 512 * 1024
/** Optional tiny inline preview for images. */
export const THUMB_MAX_BYTES = 10 * 1024
/** Client-side image downscale before sending. */
export const IMAGE_MAX_SIDE = 1600
export const IMAGE_QUALITY = 0.8

export type FileKind = 'image' | 'video' | 'file'

export class FileTooLargeError extends Error {
  constructor(public bytes: number) {
    super(`file too large: ${bytes} > ${MAX_FILE_BYTES}`)
    this.name = 'FileTooLargeError'
  }
}

/**
 * Strip path components, control characters and bidi overrides; cap length.
 * A malicious name must never be able to traverse paths, spoof extensions or
 * confuse RTL rendering.
 */
export function sanitizeFileName(raw: string, max = 128): string {
  let s = String(raw ?? '')
  const lastSegment = s.split(/[\\/]/).pop() ?? s // drop any path part
  s = lastSegment
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '') // control chars
  s = s.replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, '') // bidi overrides
  s = s.replace(/^\.\.+/g, '') // never look like a traversal
  s = s.trim().replace(/^\.+/, '')
  if (s.length > max) s = s.slice(0, max)
  if (!s) s = 'file'
  return s
}

/** Coarse kind bucket for rendering. Unknown/other = generic file card. */
export function kindForMime(mime: string): FileKind {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  return 'file'
}

/**
 * Content sniffing: does the byte prefix really look like a raster image?
 * An envelope may LIE about its mime — never render claimed images unverified,
 * and never render SVG/HTML inline at all (file card instead).
 */
export function sniffImageKind(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | null {
  const b = bytes
  const starts = (...arr: number[]): boolean => arr.every((v, i) => b[i] === v)
  if (b.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (b.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'jpeg'
  if (b.length >= 6 && starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (b.length >= 12 && starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'webp'
  }
  if (b.length >= 2 && starts(0x42, 0x4d)) return 'bmp'
  return null
}

export function looksLikeImage(bytes: Uint8Array, mime: string): boolean {
  const m = (mime || '').toLowerCase()
  if (m.includes('svg') || m.includes('html') || m.includes('xml')) return false
  if (!m.startsWith('image/')) return false
  return sniffImageKind(bytes) !== null
}

/** hex sha256 of a byte array (uses WebCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function chunkCountFor(size: number, chunkSize = FILE_CHUNK_BYTES): number {
  return Math.max(1, Math.ceil(size / chunkSize))
}


/* ------------------------------------------------------------------ */
/* Image pipeline: downscale + re-encode (strips EXIF/GPS metadata)     */
/* ------------------------------------------------------------------ */

export interface PreparedImage {
  blob: Blob
  mime: string
  width: number
  height: number
}

interface DrawContext {
  drawImage: (img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) => void
}

interface CanvasLike {
  width: number
  height: number
  getContext: (kind: '2d') => DrawContext | null
}

/**
 * Decode an image, scale it so the long side is <= maxSide and re-encode it.
 * Re-encoding through a canvas is what STRIPS EXIF/GPS metadata (they never
 * survive a canvas round-trip) and lets large photos fit the 5 MB budget.
 *
 * `canvasFactory` is injectable so tests can mock the canvas.
 */
export async function resizeImageBlob(
  source: Blob,
  opts: { maxSide?: number; quality?: number; type?: string } = {},
  canvasFactory: () => CanvasLike | null = defaultCanvas,
): Promise<PreparedImage> {
  const maxSide = opts.maxSide ?? IMAGE_MAX_SIDE
  const quality = opts.quality ?? IMAGE_QUALITY
  const type = opts.type ?? 'image/webp'
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = canvasFactory()
  if (!canvas) throw new Error('no-canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-2d-context')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await canvasToBlob(canvas as HTMLCanvasElement, type, quality)
  return { blob, mime: blob.type || type, width, height }
}

function defaultCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  return document.createElement('canvas')
}

/** Convert a canvas to a Blob; DOM canvas `toBlob` / OffscreenCanvas fallback. */
export function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  const dom = canvas as HTMLCanvasElement
  if (typeof dom.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      dom.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode-failed'))),
        type,
        quality,
      )
    })
  }
  const off = canvas as OffscreenCanvas
  return off.convertToBlob({ type, quality })
}

/** Build a tiny data-URL preview (<= thumbMax bytes) for image messages. */
export async function makeThumbnail(source: Blob, thumbMax = THUMB_MAX_BYTES): Promise<string | undefined> {
  try {
    const small = await resizeImageBlob(source, { maxSide: 96, quality: 0.6, type: 'image/webp' })
    if (small.blob.size > thumbMax) return undefined
    return await blobToDataUrl(small.blob)
  } catch {
    return undefined
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read-failed'))
    r.readAsDataURL(blob)
  })
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** Enforce the size cap on a file about to be sent. Throws FileTooLargeError. */
export function assertSendableSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) throw new FileTooLargeError(bytes)
}

/** Enforce the size cap on a file offer we received. */
export function isReceivableSize(meta: { size: number }): boolean {
  return Number.isFinite(meta.size) && meta.size > 0 && meta.size <= MAX_FILE_BYTES
}
