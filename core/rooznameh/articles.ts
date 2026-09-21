/**
 * Rooznameh article & category model (pure, unit-testable).
 * The composable (`app/composables/useRooznameh.ts`) feeds raw .md strings in;
 * everything that can be decided offline lives here.
 */
import { splitFrontmatter, type FrontmatterResult } from './frontmatter'
import { parseDirectives, isKnownDirective, type RzBlock } from './directives'
import { resolveMediaUrl } from './media'

export interface RzCategory {
  id: string
  nameEn: string
  nameFa: string
  color?: string
}

export interface RzArticle {
  /** url slug — the .md file name without extension */
  slug: string
  title: string
  description: string
  /** unix ms */
  date: number
  /** ISO string as written in the frontmatter (kept for display/fallback) */
  dateText: string
  /** validated category id (null when missing/unknown — the UI shows no chip) */
  categoryId: string | null
  categoryWarning: string | null
  cover: string | null
  author?: string
  tags: string[]
  /** reading time in whole minutes (>= 1) */
  readingMinutes: number
  /** parsed directive blocks */
  blocks: RzBlock[]
  /** any unknown directives encountered (renderer degrades them to text) */
  unknownDirectives: string[]
}

export interface BuildResult {
  article: RzArticle | null
  /** human-readable warnings (unknown category, bad date, …) — also console.warn'ed */
  warnings: string[]
}

/** Shape check for a date value: `YYYY-MM-DD` (optionally with time) or full ISO. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/

/** Normalize the categories list from `_categories.md` frontmatter. */
export function normalizeCategories(data: Record<string, unknown>): RzCategory[] {
  const rawList = Array.isArray(data.categories) ? data.categories : []
  const out: RzCategory[] = []
  const seen = new Set<string>()
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = String(rec.id ?? '').trim()
    if (!id || seen.has(id)) continue // skip empty/duplicate ids
    seen.add(id)
    out.push({
      id,
      nameEn: String(rec.name_en ?? rec.nameEn ?? id),
      nameFa: String(rec.name_fa ?? rec.nameFa ?? rec.name_en ?? rec.nameEn ?? id),
      color: typeof rec.color === 'string' && rec.color.trim() ? rec.color.trim() : undefined,
    })
  }
  return out
}

/**
 * Validate an article's category against the defined list. Unknown/missing ids
 * warn clearly (console + returned flag) and resolve to `null` — the UI then
 * renders the article without a category chip instead of failing.
 */
export function validateCategory(id: unknown, categories: RzCategory[]): { id: string | null; warning: string | null } {
  if (id === undefined || id === null || String(id).trim() === '') {
    return { id: null, warning: null } // optional field — no chip, no warning
  }
  const sid = String(id).trim()
  const found = categories.find((c) => c.id === sid)
  if (found) return { id: found.id, warning: null }
  return {
    id: null,
    warning: `[rooznameh] category "${sid}" is not defined in content/rooznameh/_categories.md — add it or fix the article's frontmatter.`,
  }
}

/** Rough reading time: 200 wpm, minimum 1 minute (words split on whitespace). */
export function readingMinutes(text: string): number {
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => asString(x).trim()).filter(Boolean)
}

/**
 * Build one article from raw markdown. Returns `article: null` for drafts or
 * files without a usable title (both skipped, drafts silently, no-title with
 * a warning).
 */
export function buildArticle(slug: string, raw: string, categories: RzCategory[], baseURL = '/'): BuildResult {
  const warnings: string[] = []
  const fm: FrontmatterResult = splitFrontmatter(raw)
  const data = fm.data

  if (data.draft === true || data.draft === 'true') return { article: null, warnings }

  const title = asString(data.title).trim()
  if (!title) {
    warnings.push(`[rooznameh] ${slug}.md has no title — article skipped.`)
    return { article: null, warnings }
  }

  const dateText = asString(data.date).trim()
  let date = Date.now()
  if (dateText && ISO_DATE.test(dateText)) {
    const iso = dateText.length === 10 ? `${dateText}T00:00:00` : dateText.replace(' ', 'T')
    const parsed = new Date(iso).getTime()
    if (Number.isFinite(parsed)) date = parsed
    else warnings.push(`[rooznameh] ${slug}.md has an unparsable date "${dateText}" — using now.`)
  } else if (dateText) {
    warnings.push(`[rooznameh] ${slug}.md date should be YYYY-MM-DD (got "${dateText}") — using now.`)
  }

  const cat = validateCategory(data.category, categories)
  if (cat.warning) warnings.push(`[rooznameh] ${slug}.md: ${cat.warning}`)

  let cover: string | null = null
  if (data.cover) {
    cover = resolveMediaUrl(asString(data.cover), baseURL)
    if (!cover) warnings.push(`[rooznameh] ${slug}.md cover "${asString(data.cover)}" is not a safe /media path — ignored.`)
  }

  const blocks = parseDirectives(fm.body)
  const unknownDirectives = [...new Set(blocks.map((b) => b.name).filter((n) => !isKnownDirective(n)))]
  if (unknownDirectives.length) {
    warnings.push(`[rooznameh] ${slug}.md uses unknown directive(s) ${unknownDirectives.map((n) => `#${n}`).join(', ')} — rendered as plain text.`)
  }

  return {
    article: {
      slug,
      title,
      description: asString(data.description).trim(),
      date,
      dateText,
      categoryId: cat.id,
      categoryWarning: cat.warning,
      cover,
      author: asString(data.author).trim() || undefined,
      tags: asStringArray(data.tags),
      readingMinutes: readingMinutes(`${title} ${asString(data.description)} ${fm.body}`),
      blocks,
      unknownDirectives,
    },
    warnings,
  }
}

/** Sort comparator: newest first; ties broken by slug for stable output. */
export function byNewest(a: RzArticle, b: RzArticle): number {
  return b.date - a.date || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
}