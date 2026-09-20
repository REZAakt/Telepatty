import { describe, expect, it } from 'vitest'
import {
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  chunkCountFor,
  formatBytes,
  isReceivableSize,
  looksLikeImage,
  sanitizeFileName,
  sniffImageKind,
  assertSendableSize,
  FileTooLargeError,
} from './files'

describe('file limits', () => {
  it('hard cap is exactly 5 MB', () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024)
  })

  it('sender side rejects anything larger (assertSendableSize)', () => {
    expect(() => assertSendableSize(4 * 1024 * 1024)).not.toThrow()
    expect(() => assertSendableSize(MAX_FILE_BYTES)).not.toThrow()
    expect(() => assertSendableSize(MAX_FILE_BYTES + 1)).toThrow(FileTooLargeError)
  })

  it('receiver side rejects offers larger than the cap', () => {
    expect(isReceivableSize({ size: 1024 })).toBe(true)
    expect(isReceivableSize({ size: MAX_FILE_BYTES })).toBe(true)
    expect(isReceivableSize({ size: MAX_FILE_BYTES + 1 })).toBe(false)
    expect(isReceivableSize({ size: 0 })).toBe(false)
    expect(isReceivableSize({ size: Number.NaN })).toBe(false)
  })

  it('chunk planning covers the whole file', () => {
    expect(chunkCountFor(0)).toBe(1)
    expect(chunkCountFor(1)).toBe(1)
    expect(chunkCountFor(FILE_CHUNK_BYTES)).toBe(1)
    expect(chunkCountFor(FILE_CHUNK_BYTES + 1)).toBe(2)
    expect(chunkCountFor(5 * 1024 * 1024, 16 * 1024)).toBe(320)
  })

  it('formats bytes for UI', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB')
    expect(formatBytes(undefined)).toBe('—')
  })
})

describe('file name sanitisation', () => {
  it('strips path traversal', () => {
    expect(sanitizeFileName('..\\..\\evil.exe')).toBe('evil.exe')
    expect(sanitizeFileName('/etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\temp\\report.pdf')).toBe('report.pdf')
  })

  it('removes control characters', () => {
    expect(sanitizeFileName('bad\u0000\u001fname.txt')).toBe('badname.txt')
  })

  it('removes bidi overrides (no RTL spoofing)', () => {
    const out = sanitizeFileName('safe\u202Egnp.exe')
    expect(out).not.toContain('\u202E')
    expect(out).toBe('safegnp.exe')
  })

  it('caps length and never returns empty', () => {
    expect(sanitizeFileName('a'.repeat(500)).length).toBe(128)
    expect(sanitizeFileName('')).toBe('file')
    expect(sanitizeFileName('...')).toBe('file')
  })
})

describe('content sniffing (never trust the declared mime)', () => {
  it('recognises real image magic bytes', () => {
    expect(sniffImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    expect(sniffImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImageKind(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif')
    expect(sniffImageKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('webp')
    expect(sniffImageKind(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('bmp')
  })

  it('rejects non-image payloads', () => {
    expect(sniffImageKind(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(null) // "%PDF"
    expect(sniffImageKind(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBe(null) // "<svg"
  })

  it('never renders SVG/HTML as an image even when claimed', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(looksLikeImage(svg, 'image/svg+xml')).toBe(false)
    expect(looksLikeImage(svg, 'image/svg')).toBe(false)
  })

  it('accepts genuine images and rejects an exe claiming image/png', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(looksLikeImage(png, 'image/png')).toBe(true)
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00])
    expect(looksLikeImage(exe, 'image/png')).toBe(false)
    expect(looksLikeImage(png, 'application/pdf')).toBe(false)
  })
})
