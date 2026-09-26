import { describe, expect, it } from 'vitest'
import { parseYamlSubset, splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  it('splits a --- fenced header from the body', () => {
    const { data, body } = splitFrontmatter('---\ntitle: Hello\ndate: 2026-01-02\n---\n\n#text\nBody line\n')
    expect(data.title).toBe('Hello')
    expect(data.date).toBe('2026-01-02')
    expect(body).toBe('#text\nBody line\n')
  })

  it('returns empty meta when there is no frontmatter', () => {
    const { data, body } = splitFrontmatter('#text\njust text\n')
    expect(data).toEqual({})
    expect(body).toBe('#text\njust text\n')
  })

  it('tolerates an unclosed fence (treats everything as body)', () => {
    const { data, body } = splitFrontmatter('---\ntitle: never closed')
    expect(data).toEqual({})
    expect(body).toContain('never closed')
  })

  it('handles CRLF line endings', () => {
    const { data, body } = splitFrontmatter('---\r\ntitle: A\r\n---\r\nbody\r\n')
    expect(data.title).toBe('A')
    expect(body.startsWith('body')).toBe(true)
  })
})

describe('parseYamlSubset', () => {
  it('parses unquoted, single and double quoted scalars', () => {
    const d = parseYamlSubset("a: plain\nb: 'single'\nc: \"double\"\n")
    expect(d.a).toBe('plain')
    expect(d.b).toBe('single')
    expect(d.c).toBe('double')
  })

  it('coerces numbers and booleans but keeps ISO dates as strings', () => {
    const d = parseYamlSubset('n: 42\nf: 3.5\nt: true\nfa: false\nd: 2026-02-01\ndt: 2026-02-01T10:00:00Z\n')
    expect(d.n).toBe(42)
    expect(d.f).toBe(3.5)
    expect(d.t).toBe(true)
    expect(d.fa).toBe(false)
    expect(d.d).toBe('2026-02-01')
    expect(d.dt).toBe('2026-02-01T10:00:00Z')
  })

  it('parses inline arrays with quotes and spaces', () => {
    const d = parseYamlSubset("tags: ['موبایل ', 'مدیریت کاربران', plain]\n")
    expect(d.tags).toEqual(['موبایل ', 'مدیریت کاربران', 'plain'])
  })

  it('parses block lists of plain strings', () => {
    const d = parseYamlSubset('tags:\n  - one\n  - two\n  - three\n')
    expect(d.tags).toEqual(['one', 'two', 'three'])
  })

  it('parses block lists of one-level maps (reference-project style)', () => {
    const src = [
      'media:',
      '  - type: image',
      '',
      '    src: /images/a.webp',
      '',
      '  - type: image',
      '',
      '    src: /images/b.webp',
      '',
    ].join('\n')
    const d = parseYamlSubset(src)
    expect(d.media).toEqual([
      { type: 'image', src: '/images/a.webp' },
      { type: 'image', src: '/images/b.webp' },
    ])
  })

  it('parses categories with quoted unicode values', () => {
    const d = parseYamlSubset(
      "categories:\n  - id: tech\n    name_en: Technology\n    name_fa: 'تکنولوژی'\n    color: '#22d3ee'\n  - id: games\n    name_en: Games\n",
    )
    expect(d.categories).toEqual([
      { id: 'tech', name_en: 'Technology', name_fa: 'تکنولوژی', color: '#22d3ee' },
      { id: 'games', name_en: 'Games' },
    ])
  })

  it('ignores comment lines and blank lines', () => {
    const d = parseYamlSubset('# a comment\ntitle: X\n\n# another\n')
    expect(d).toEqual({ title: 'X' })
  })

  it('tolerates malformed input without throwing', () => {
    expect(() => parseYamlSubset('::: bad\n\n   weird\nkey without colon')).not.toThrow()
    expect(parseYamlSubset('')).toEqual({})
  })
})