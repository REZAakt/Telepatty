import { describe, expect, it } from 'vitest'
import {
  parseDirectives,
  parseAdBlock,
  parseCalloutLines,
  parseMediaLine,
  parseQuoteLines,
  parseSourceLine,
  mediaKind,
  isKnownDirective,
} from './directives'

describe('parseDirectives', () => {
  it('parses all block types', () => {
    const src = [
      '#text',
      'Hello **world**',
      '#media',
      'a.png | caption A',
      'b.mp4',
      '#quote',
      'To be or not to be',
      '| Shakespeare',
      '#callout',
      'warning',
      'Careful!',
      '#ad',
      'banner.png | Alt text',
      'https://example.com',
      'Sponsored text',
      '#source',
      'Wikipedia | https://en.wikipedia.org',
    ].join('\n')
    const blocks = parseDirectives(src)
    expect(blocks.map((b) => b.name)).toEqual(['text', 'media', 'quote', 'callout', 'ad', 'source'])
    expect(blocks[0].lines).toEqual(['Hello **world**'])
    expect(blocks[1].lines).toEqual(['a.png | caption A', 'b.mp4'])
    expect(blocks[2].lines).toEqual(['To be or not to be', '| Shakespeare'])
    expect(blocks[3].lines).toEqual(['warning', 'Careful!'])
    expect(blocks[4].lines).toEqual(['banner.png | Alt text', 'https://example.com', 'Sponsored text'])
    expect(blocks[5].lines).toEqual(['Wikipedia | https://en.wikipedia.org'])
  })

  it('terminates blocks on a line containing only #', () => {
    const blocks = parseDirectives('#text\none\n#\ntwo\n')
    expect(blocks.map((b) => b.name)).toEqual(['text', 'text'])
    expect(blocks[0].lines).toEqual(['one'])
    expect(blocks[1].lines).toEqual(['two'])
  })

  it('terminates blocks on a line containing only -- (exactly two dashes)', () => {
    const blocks = parseDirectives('#text\none\n--\ntwo\n')
    expect(blocks.map((b) => b.name)).toEqual(['text', 'text'])
    expect(blocks[0].lines).toEqual(['one'])
    expect(blocks[1].lines).toEqual(['two'])
  })

  it('keeps markdown --- (three dashes) inside a text block as an hr', () => {
    const blocks = parseDirectives('#text\none\n---\ntwo\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual(['one', '---', 'two'])
  })

  it('content before the first directive becomes an implicit text block', () => {
    const blocks = parseDirectives('plain **markdown**\n#media\nx.png\n')
    expect(blocks.map((b) => b.name)).toEqual(['text', 'media'])
    expect(blocks[0].lines).toEqual(['plain **markdown**'])
  })

  it('content after a terminator starts a new implicit text block', () => {
    const blocks = parseDirectives('#text\na\n#\nplain after\n')
    expect(blocks.map((b) => b.name)).toEqual(['text', 'text'])
    expect(blocks[1].lines).toEqual(['plain after'])
  })

  it('ends the last block at EOF', () => {
    const blocks = parseDirectives('#text\na\nb')
    expect(blocks[0].lines).toEqual(['a', 'b'])
  })

  it('keeps unknown directives (renderer degrades them, warning is raised)', () => {
    const blocks = parseDirectives('#nonsense\nhidden\n')
    expect(blocks).toEqual([{ name: 'nonsense', lines: ['hidden'] }])
    expect(isKnownDirective('nonsense')).toBe(false)
    expect(isKnownDirective('media')).toBe(true)
  })

  it('handles malformed input without throwing', () => {
    expect(() => parseDirectives('')).not.toThrow()
    expect(() => parseDirectives('#\n--\n#text')).not.toThrow()
    expect(() => parseDirectives('#unclosed no name line\n')).not.toThrow()
    // an unterminated block still yields its lines
    expect(parseDirectives('#media\na.png')).toEqual([{ name: 'media', lines: ['a.png'] }])
  })

  it('drops empty text blocks — explicit or implicit (no phantom content)', () => {
    const blocks = parseDirectives('#text\n\n#media\na.png\n')
    expect(blocks.map((b) => b.name)).toEqual(['media'])
    expect(blocks[0].lines).toEqual(['a.png'])
  })
})

describe('block sub-parsers', () => {
  it('parseMediaLine splits name and caption', () => {
    expect(parseMediaLine('a.png | Hello')).toEqual({ name: 'a.png', caption: 'Hello' })
    expect(parseMediaLine('a.png')).toEqual({ name: 'a.png', caption: undefined })
    expect(parseMediaLine('a.png | ')).toEqual({ name: 'a.png', caption: undefined })
    expect(parseMediaLine('clip.mp4 | a | b | c')).toEqual({ name: 'clip.mp4', caption: 'a | b | c' })
  })

  it('mediaKind distinguishes video files', () => {
    expect(mediaKind('a.png')).toBe('image')
    expect(mediaKind('a.webp')).toBe('image')
    expect(mediaKind('a.MP4')).toBe('video')
    expect(mediaKind('clip.webm')).toBe('video')
  })

  it('parseAdBlock reads image/url/label with or without image', () => {
    expect(parseAdBlock(['banner.png | Alt', 'https://example.com', 'Buy things'])).toEqual({
      image: 'banner.png',
      alt: 'Alt',
      url: 'https://example.com',
      label: 'Buy things',
    })
    expect(parseAdBlock(['https://example.com', 'Some promo text'])).toEqual({
      image: undefined,
      alt: undefined,
      url: 'https://example.com',
      label: 'Some promo text',
    })
  })

  it('parseQuoteLines extracts the source from a | line', () => {
    expect(parseQuoteLines(['To be…', '| Shakespeare'])).toEqual({ md: 'To be…', source: 'Shakespeare' })
    expect(parseQuoteLines(['just a quote'])).toEqual({ md: 'just a quote', source: undefined })
  })

  it('parseCalloutLines defaults to info and understands warning', () => {
    expect(parseCalloutLines(['warning', 'Careful!'])).toEqual({ variant: 'warning', md: 'Careful!' })
    expect(parseCalloutLines(['plain text'])).toEqual({ variant: 'info', md: 'plain text' })
  })

  it('parseSourceLine keeps only http(s) urls', () => {
    expect(parseSourceLine('Wikipedia | https://en.wikipedia.org')).toEqual({ text: 'Wikipedia', url: 'https://en.wikipedia.org' })
    expect(parseSourceLine('just text')).toEqual({ text: 'just text', url: undefined })
  })
})