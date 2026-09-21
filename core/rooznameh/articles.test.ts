import { describe, expect, it, vi, afterEach } from 'vitest'
import { normalizeCategories, validateCategory, buildArticle, readingMinutes, byNewest } from './articles'
import { resolveMediaUrl, cleanMediaName } from './media'

const categories = normalizeCategories({
  categories: [
    { id: 'tech', name_en: 'Technology', name_fa: 'تکنولوژی', color: '#22d3ee' },
    { id: 'games', name_en: 'Games', name_fa: 'بازی' },
  ],
})

afterEach(() => vi.restoreAllMocks())

describe('normalizeCategories', () => {
  it('maps the reference-style frontmatter list', () => {
    expect(categories).toEqual([
      { id: 'tech', nameEn: 'Technology', nameFa: 'تکنولوژی', color: '#22d3ee' },
      { id: 'games', nameEn: 'Games', nameFa: 'بازی', color: undefined },
    ])
  })

  it('skips empty and duplicate ids, tolerates garbage entries', () => {
    const out = normalizeCategories({ categories: [{ id: 'a' }, { id: 'a' }, { id: '' }, 'junk', null] })
    expect(out.map((c) => c.id)).toEqual(['a'])
    expect(normalizeCategories({})).toEqual([])
  })
})

describe('validateCategory', () => {
  it('accepts defined ids', () => {
    expect(validateCategory('tech', categories)).toEqual({ id: 'tech', warning: null })
  })
  it('treats an absent category as optional (no warning)', () => {
    expect(validateCategory(undefined, categories)).toEqual({ id: null, warning: null })
    expect(validateCategory('', categories)).toEqual({ id: null, warning: null })
  })
  it('warns clearly on a mismatch with the defined ids', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = validateCategory('nonsense', categories)
    expect(res.id).toBeNull()
    expect(res.warning).toContain('"nonsense"')
    expect(res.warning).toContain('_categories.md')
    warn.mockRestore()
  })
})

describe('resolveMediaUrl / cleanMediaName', () => {
  it('allows bare names, subpaths and /media/ prefixes', () => {
    expect(resolveMediaUrl('cover.webp')).toBe('/media/cover.webp')
    expect(resolveMediaUrl('sub/dir/pic.png')).toBe('/media/sub/dir/pic.png')
    expect(resolveMediaUrl('/media/cover.webp')).toBe('/media/cover.webp')
    expect(resolveMediaUrl('a.png', '/mag/')).toBe('/mag/media/a.png')
  })

  it('rejects traversal, external urls, schemes and junk', () => {
    expect(resolveMediaUrl('../secrets/env')).toBeNull()
    expect(resolveMediaUrl('a/../../etc/passwd')).toBeNull()
    expect(resolveMediaUrl('https://evil.com/x.png')).toBeNull()
    expect(resolveMediaUrl('data:text/html;base64,AAAA')).toBeNull()
    expect(resolveMediaUrl('//evil.com/x.png')).toBeNull()
    expect(resolveMediaUrl('')).toBeNull()
    expect(resolveMediaUrl('no extension')).toBeNull()
    expect(cleanMediaName('a\u202eb.png')).toBe('ab.png') // bidi override stripped
  })
})

describe('readingMinutes / byNewest', () => {
  it('is at least 1 minute and scales with word count', () => {
    expect(readingMinutes('')).toBe(1)
    expect(readingMinutes('word '.repeat(400))).toBe(2)
  })

  it('sorts newest first with a stable slug tiebreak', () => {
    const a = { date: 2, slug: 'a' } as never
    const b = { date: 1, slug: 'b' } as never
    const c = { date: 2, slug: 'c' } as never
    expect(byNewest(a, b)).toBeLessThanOrEqual(0)
    expect(byNewest(a, c)).toBeLessThan(0)
    expect(byNewest(b, a)).toBeGreaterThan(0)
  })
})

describe('buildArticle', () => {
  const md = [
    '---',
    "title: 'Hello روoznameh'",
    'description: A short one',
    'date: 2026-02-01',
    'category: tech',
    'cover: /media/cover.webp',
    "author: 'R. Akta'",
    "tags: ['x', 'y']",
    '---',
    '',
    'Intro paragraph.',
    '',
    '#media',
    'shot.png | A caption',
  ].join('\n')

  it('builds a full article', () => {
    const { article, warnings } = buildArticle('hello', md, categories)
    expect(warnings).toEqual([])
    expect(article).not.toBeNull()
    expect(article!.slug).toBe('hello')
    expect(article!.title).toBe('Hello روoznameh')
    expect(article!.dateText).toBe('2026-02-01')
    expect(article!.date).toBe(new Date('2026-02-01T00:00:00').getTime())
    expect(article!.categoryId).toBe('tech')
    expect(article!.cover).toBe('/media/cover.webp')
    expect(article!.author).toBe('R. Akta')
    expect(article!.tags).toEqual(['x', 'y'])
    expect(article!.readingMinutes).toBeGreaterThanOrEqual(1)
    expect(article!.blocks.map((b) => b.name)).toEqual(['text', 'media'])
    expect(article!.unknownDirectives).toEqual([])
  })

  it('excludes drafts from the build', () => {
    const { article } = buildArticle('d', '---\ntitle: Draft\ndraft: true\n---\nbody', categories)
    expect(article).toBeNull()
  })

  it('skips articles without a title (with a warning)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { article, warnings } = buildArticle('no-title', '---\ndate: 2026-01-01\n---\nbody', categories)
    expect(article).toBeNull()
    expect(warnings[0]).toContain('no title')
    warn.mockRestore()
  })

  it('warns on an unknown category and keeps the article without a chip', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { article, warnings } = buildArticle('x', '---\ntitle: X\ncategory: ghost\n---\nbody', categories)
    expect(article!.categoryId).toBeNull()
    expect(warnings.join('\n')).toContain('category "ghost"')
    warn.mockRestore()
  })

  it('warns on a malformed date and falls back to now', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { article, warnings } = buildArticle('x', '---\ntitle: X\ndate: not-a-date\n---\nbody', categories)
    expect(article!.dateText).toBe('not-a-date')
    expect(Math.abs(article!.date - Date.now())).toBeLessThan(5000)
    expect(warnings.join('\n')).toContain('date')
    warn.mockRestore()
  })

  it('flags unknown directives and rejects unsafe covers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { article, warnings } = buildArticle('x', '---\ntitle: X\ncover: https://evil.com/a.png\n---\n#whatever\nhi', categories)
    expect(article!.cover).toBeNull()
    expect(article!.unknownDirectives).toEqual(['whatever'])
    expect(warnings.join('\n')).toContain('unknown directive')
    expect(warnings.join('\n')).toContain('cover')
    warn.mockRestore()
  })
})