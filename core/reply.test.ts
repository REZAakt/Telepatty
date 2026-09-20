import { describe, expect, it } from 'vitest'
import { EXCERPT_MAX, cycleReplyTarget, canStartReplyCycle, makeExcerpt, replyRefOf, sanitizeReplyRef, truncateExcerpt } from './reply'

const pk = 'ab'.repeat(32)
const pk2 = 'cd'.repeat(32)

describe('reply excerpts', () => {
  it('truncates long text to the cap with an ellipsis', () => {
    const long = 'x'.repeat(300)
    const out = makeExcerpt(long)
    expect(out.length).toBe(EXCERPT_MAX)
    expect(out.endsWith('…')).toBe(true)
  })

  it('keeps short text and collapses whitespace', () => {
    expect(makeExcerpt('  hello \n world  ')).toBe('hello world')
  })

  it('uses the localized attachment label when there is no text', () => {
    expect(makeExcerpt('', 'Photo')).toBe('Photo')
    expect(makeExcerpt(undefined, 'File')).toBe('File')
    expect(makeExcerpt(undefined)).toBe('')
  })

  it('prefers text over the label', () => {
    expect(makeExcerpt('caption', 'Photo')).toBe('caption')
  })

  it('strips bidi overrides and control characters', () => {
    const dirty = 'a\u202eb\u0000c\u200fd'
    const out = truncateExcerpt(dirty)
    expect(out).toBe('abcd')
    expect(truncateExcerpt('\u061cx')).toBe('x')
  })

  it('returns empty (never throws) for empty input', () => {
    expect(makeExcerpt('')).toBe('')
    expect(truncateExcerpt('')).toBe('')
  })
})

describe('reply reference sanitisation (receive side)', () => {
  it('accepts a well-formed reference', () => {
    const ref = sanitizeReplyRef({ id: 'm-1', senderPubkey: pk.toUpperCase(), excerpt: 'hi' })
    expect(ref).toEqual({ id: 'm-1', senderPubkey: pk, excerpt: 'hi' })
  })

  it('rejects non-objects, bad pubkeys and missing ids', () => {
    expect(sanitizeReplyRef(null)).toBeUndefined()
    expect(sanitizeReplyRef('x')).toBeUndefined()
    expect(sanitizeReplyRef({ id: 'm', senderPubkey: 'nothex', excerpt: '' })).toBeUndefined()
    expect(sanitizeReplyRef({ senderPubkey: pk, excerpt: '' })).toBeUndefined()
  })

  it('caps oversized excerpts from the wire', () => {
    const ref = sanitizeReplyRef({ id: 'm', senderPubkey: pk, excerpt: 'y'.repeat(500) })
    expect(ref?.excerpt.length).toBe(EXCERPT_MAX)
  })

  it('drops non-string fields gracefully', () => {
    expect(sanitizeReplyRef({ id: 5, senderPubkey: pk, excerpt: 9 })).toBeUndefined()
  })
})

describe('reply reference build (send side)', () => {
  it('builds from stored fields', () => {
    const ref = replyRefOf('m-1', pk, 'snippet')
    expect(ref).toEqual({ id: 'm-1', senderPubkey: pk, excerpt: 'snippet' })
  })

  it('refuses without an id or a valid pubkey', () => {
    expect(replyRefOf(undefined, pk, 'x')).toBeUndefined()
    expect(replyRefOf('m', 'bad', 'x')).toBeUndefined()
  })
})

describe('keyboard reply-target cycling (Arrow Up / Arrow Down)', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] // oldest → newest

  it('up: from none → newest, then walks older', () => {
    expect(cycleReplyTarget(list, null, 'up')).toBe('c')
    expect(cycleReplyTarget(list, 'c', 'up')).toBe('b')
    expect(cycleReplyTarget(list, 'b', 'up')).toBe('a')
  })

  it('up: stays at the oldest message', () => {
    expect(cycleReplyTarget(list, 'a', 'up')).toBe('a')
  })

  it('down: walks newer, then cancels (null)', () => {
    expect(cycleReplyTarget(list, 'a', 'down')).toBe('b')
    expect(cycleReplyTarget(list, 'b', 'down')).toBe('c')
    expect(cycleReplyTarget(list, 'c', 'down')).toBe(null)
    expect(cycleReplyTarget(list, null, 'down')).toBe(null)
  })

  it('handles unknown ids and empty chats', () => {
    expect(cycleReplyTarget(list, 'zz', 'up')).toBe('c')
    expect(cycleReplyTarget([], null, 'up')).toBe(null)
  })
})

describe('ArrowUp start conditions', () => {
  it('only fires with an empty composer and caret at start', () => {
    expect(canStartReplyCycle({ value: '', selectionStart: 0, selectionEnd: 0, isComposing: false })).toBe(true)
  })

  it('never hijacks the caret when text or a selection exists', () => {
    expect(canStartReplyCycle({ value: 'hi', selectionStart: 0, selectionEnd: 0, isComposing: false })).toBe(false)
    expect(canStartReplyCycle({ value: '', selectionStart: 0, selectionEnd: 0, isComposing: true })).toBe(false)
    expect(canStartReplyCycle({ value: '', selectionStart: 2, selectionEnd: 3, isComposing: false })).toBe(false)
  })
})
