import { describe, expect, it } from 'vitest'
import {
  articleBodyHtml,
  articleHeadHtml,
  escapeHtml,
  injectIntoShell,
  listHeadHtml,
  markdownToPlainText,
  resolveOgImage,
} from './seo'
import { buildArticle, normalizeCategories } from './articles'
import { splitFrontmatter } from './frontmatter'

const ORIGIN = 'https://telepatty.ir'
const BASE = '/'

/** Build an article from frontmatter + body, exactly like the app does. */
function article(fm: string, body: string) {
  const categories = normalizeCategories({ categories: [{ id: 'tech', name_en: 'Technology', name_fa: 'تکنولوژی' }] })
  const { article } = buildArticle('hello-world', `---\n${fm}\n---\n\n${body}`, categories, BASE)
  expect(article).toBeTruthy()
  return article!
}

describe('escapeHtml', () => {
  it('escapes quotes and HTML-significant characters', () => {
    expect(escapeHtml(`a"b<c>d&e'f`)).toBe('a&quot;b&lt;c&gt;d&amp;e&#39;f')
  })
})

describe('markdownToPlainText', () => {
  it('keeps link text, drops images to alt, strips emphasis', () => {
    expect(markdownToPlainText('[click **here**](https://x.ex)')).toBe('click here')
    expect(markdownToPlainText('![a secret](/media/a.png)')).toBe('a secret')
    expect(markdownToPlainText('## Heading')).toBe('Heading')
    expect(markdownToPlainText('- item one')).toBe('item one')
  })
})

describe('resolveOgImage (og:image must be an absolute PNG/JPG URL)', () => {
  it('accepts an existing PNG/JPG cover and makes it absolute', () => {
    const r = resolveOgImage({ slug: 'a', cover: '/media/cover.png' }, { origin: ORIGIN, baseURL: BASE, exists: () => true })
    expect(r).toEqual({ url: 'https://telepatty.ir/media/cover.png', fallback: false })
  })
  it('falls back with a warning for SVG covers', () => {
    const r = resolveOgImage({ slug: 'a', cover: '/media/cover.svg' }, { origin: ORIGIN, baseURL: BASE, exists: () => true })
    expect(r.fallback).toBe(true)
    expect(r.url).toBe('https://telepatty.ir/media/og-default.png')
    expect(r.warning).toContain('a')
  })
  it('falls back with a warning when the cover file is missing', () => {
    const r = resolveOgImage({ slug: 'a', cover: '/media/cover.jpg' }, { origin: ORIGIN, baseURL: BASE, exists: () => false })
    expect(r.fallback).toBe(true)
    expect(r.warning).toContain('not found')
  })
  it('falls back silently when there is no cover at all', () => {
    const r = resolveOgImage({ slug: 'a', cover: null }, { origin: ORIGIN, baseURL: BASE, exists: () => true })
    expect(r).toEqual({ url: 'https://telepatty.ir/media/og-default.png', fallback: true })
  })
  it('honors a baseURL sub-path (GitHub Pages project sites)', () => {
    // buildArticle stores covers baseURL-prefixed; only the origin is added
    const r = resolveOgImage({ slug: 'a', cover: '/tp/media/cover.jpg' }, { origin: 'https://x.ex', baseURL: '/tp/', exists: () => true })
    expect(r.url).toBe('https://x.ex/tp/media/cover.jpg')
  })
})

describe('articleHeadHtml (head-injection logic)', () => {
  const a = article(
    `title: "The "Quoted" & <Great> Article"\ndescription: 'Desc with <b>HTML</b> & "quotes"'\ndate: 2026-09-21\ncategory: tech\ncover: /media/cover.png\nauthor: "REZA"\ntags: ['alpha']`,
    'Body text.',
  )

  const html = articleHeadHtml(a, { origin: ORIGIN, baseURL: BASE, exists: () => true })

  it('emits every required tag', () => {
    expect(html).toContain('<title>')
    expect(html).toContain('name="description"')
    expect(html).toContain('rel="canonical" href="https://telepatty.ir/rooznameh/hello-world/"')
    expect(html).toContain('property="og:title"')
    expect(html).toContain('property="og:description"')
    expect(html).toContain('property="og:type" content="article"')
    expect(html).toContain('property="og:url" content="https://telepatty.ir/rooznameh/hello-world/"')
    expect(html).toContain('property="og:image" content="https://telepatty.ir/media/cover.png"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    // plain YYYY-MM-DD frontmatter dates are published at midnight UTC (stable
    // across build machines / timezones)
    expect(html).toContain('property="article:published_time" content="2026-09-21T00:00:00Z"')
  })

  it('ESCAPES quotes/HTML in titles and descriptions (frontmatter is input)', () => {
    expect(html).not.toContain('<Great>')
    expect(html).not.toContain('<b>HTML</b>')
    expect(html).toContain('&lt;Great&gt;')
    expect(html).toContain('&quot;Quoted&quot;')
    // an attacker-supplied quote must never terminate an attribute early
    expect(html).not.toContain('"><script')
  })
})

describe('articleBodyHtml (crawlable text)', () => {
  it('escapes injected HTML/markdown and keeps plain text', () => {
    const a = article(
      `title: '<img src=x onerror=alert(1)> TableRow'\ndescription: '</div><script>alert(2)</script>'\ndate: 2026-09-21`,
      `#text\n## A heading\nNormal **markdown** with [a link](https://x.ex) and ![an image](/media/a.png).\n\n<script>alert(3)</script>`,
    )
    const body = articleBodyHtml(a)
    expect(body).toContain('<h1>')
    expect(body).toContain('A heading')
    // no executable/real tags may appear — everything malicious is escaped text
    expect(body).not.toContain('<script>')
    expect(body).not.toContain('<img')
    expect(body).toContain('&lt;script&gt;')
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(body).toContain('Normal markdown with a link and an image.')
  })

  it('wraps the content in the SPA-replaced container', () => {
    const a = article(`title: T\ndate: 2026-09-21`, 'hello')
    expect(articleBodyHtml(a).startsWith('<div id="tp-rz-seo"')).toBe(true)
  })
})

describe('listHeadHtml (the /rooznameh/ index page)', () => {
  const html = listHeadHtml({ origin: ORIGIN, baseURL: BASE })
  it('emits generic title/description/og/twitter tags', () => {
    expect(html).toContain('<title>Rooznameh — Telepatty</title>')
    expect(html).toContain('rel="canonical" href="https://telepatty.ir/rooznameh/"')
    expect(html).toContain('property="og:type" content="website"')
    expect(html).toContain('media/og-default.png')
  })
})

describe('injectIntoShell (the prerendered app shell)', () => {
  const SHELL = `<!DOCTYPE html>
<html>
<head>
    <title>Telepatty</title>
    <meta name="description" content="generic">
    <meta property="og:title" content="generic">
    <meta name="twitter:card" content="summary">
</head>
<body>
<div id="__nuxt"></div>
<script type="module" src="/_nuxt/entry.js"></script>
</body>
</html>`

  it('replaces generic head tags and injects article head + crawlable body', () => {
    const out = injectIntoShell(SHELL, '    <title>Article</title>\n    <meta property="og:title" content="Article">', '<div id="tp-rz-seo"><h1>Article</h1></div>')
    expect((out.match(/<title>/g) ?? []).length).toBe(1)
    expect(out).toContain('<title>Article</title>')
    expect(out).not.toContain('>generic<')
    expect(out).toContain('id="tp-rz-seo"')
    // body lands INSIDE the app root so the SPA replaces it on mount
    expect(out.indexOf('id="tp-rz-seo"')).toBeGreaterThan(out.indexOf('id="__nuxt"'))
    expect(out).toContain('</div>\n<script type="module"')
  })

  it('is idempotent (running twice does not duplicate tags)', () => {
    const once = injectIntoShell(SHELL, '    <title>A</title>', '<div id="tp-rz-seo"><h1>A</h1></div>')
    const twice = injectIntoShell(once, '    <title>A</title>', '<div id="tp-rz-seo"><h1>A</h1></div>')
    expect((twice.match(/<title>/g) ?? []).length).toBe(1)
    expect((twice.match(/tp-rz-seo/g) ?? []).length).toBe(1)
  })

  it('falls back to <body> when #__nuxt is absent', () => {
    const out = injectIntoShell('<html><head></head><body><p>x</p></body></html>', '    <title>A</title>', '<div id="tp-rz-seo">b</div>')
    expect(out).toContain('<body>\n<div id="tp-rz-seo">b</div>')
  })
})
