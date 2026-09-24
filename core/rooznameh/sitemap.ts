/**
 * Rooznameh (روزنامه) → sitemap source (fs + pure helpers, unit-tested).
 *
 * The sitemap is NEVER written or edited by hand: `@nuxtjs/sitemap` resolves
 * `sitemap.urls` at build time and calls the helpers below, which read
 * `content/rooznameh/*.md` through the SAME frontmatter parser the app uses
 * (`splitFrontmatter`). Dropping a markdown file into `content/rooznameh/` is
 * therefore the only step needed for an article to appear in `sitemap.xml`, and
 * deleting one removes it.
 *
 * Rules — parity with the app (`buildArticle`), which stays the only source of truth:
 * - `_`-prefixed files (`_categories.md`) are not articles;
 * - `draft: true` files AND files without a `title` are skipped (the app cannot
 *   render them, so advertising their URL would only produce soft 404s);
 * - `lastmod` is the article's own frontmatter date (`updated`/`updatedAt` win over
 *   `date`) — never the build clock, so a rebuild that changes no content leaves
 *   every `lastmod` byte-identical.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { splitFrontmatter } from './frontmatter'

/** One published article, as far as the sitemap cares. */
export interface SitemapArticle {
  slug: string
  /** `YYYY-MM-DD` from the frontmatter — `''` when the file has no usable date. */
  lastmod: string
}

/** A `<url>` entry in the shape `@nuxtjs/sitemap` accepts (`{ loc, lastmod? }`). */
export interface SitemapUrlEntry {
  loc: string
  lastmod?: string
}

const DAY = /^(\d{4}-\d{2}-\d{2})/

/** `'2026-09-21'` / `'2026-09-21T10:30:00Z'` → `'2026-09-21'`; anything else → `''`. */
export function normaliseLastmod(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return DAY.exec(raw)?.[1] ?? ''
}

/** The draft rule `buildArticle()` applies (`draft: true` or `draft: 'true'`). */
export function isDraft(data: Record<string, unknown>): boolean {
  return data.draft === true || data.draft === 'true'
}

/**
 * Every article the app would publish, sorted by slug (stable output).
 * Always reads the directory, so the build and the tests see the same disk truth.
 */
export function listArticles(contentDir: string): SitemapArticle[] {
  const articles: SitemapArticle[] = []
  for (const file of readdirSync(contentDir).filter((f) => f.endsWith('.md')).sort()) {
    if (file.startsWith('_')) continue // `_categories.md` and friends are not articles
    const { data } = splitFrontmatter(readFileSync(join(contentDir, file), 'utf8'))
    if (isDraft(data)) continue
    if (!String(data.title ?? '').trim()) continue // no title → the app skips it too
    articles.push({
      slug: file.replace(/\.md$/, ''),
      lastmod: normaliseLastmod(data.updated ?? data.updatedAt ?? data.date),
    })
  }
  return articles
}

/** `/rooznameh/<slug>` per article — the routes Nitro must prerender (200, not 404). */
export function articleRoutes(articles: SitemapArticle[]): string[] {
  return articles.map((a) => `/rooznameh/${a.slug}`)
}

/** `'/'`, `'/x/'`, `''` and `undefined` → `''` (root) or `'/x'` (normalised base). */
export function basePath(baseURL?: string): string {
  const base = String(baseURL ?? '/').trim()
  if (!base || base === '/') return ''
  return `/${base.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

/** Absolute `<url>` entries for `sitemap.urls` — one per article, `lastmod` included. */
export function sitemapUrls(
  articles: SitemapArticle[],
  options: { origin: string; baseURL?: string },
): SitemapUrlEntry[] {
  const base = `${String(options.origin).replace(/\/+$/, '')}${basePath(options.baseURL)}`
  return articles.map((a) => {
    const loc = `${base}/rooznameh/${a.slug}`
    return a.lastmod ? { loc, lastmod: a.lastmod } : { loc }
  })
}
