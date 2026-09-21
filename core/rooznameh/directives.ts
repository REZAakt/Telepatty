/**
 * Rooznameh block-directive parser (pure, unit-testable).
 *
 * A block starts with a directive line `#name` and ends at the FIRST of:
 * - a line containing only `#`
 * - a line containing only `--` (exactly two dashes; markdown `---` stays an hr)
 * - the next `#name` directive line
 * - end of body
 *
 * Plain markdown BEFORE the first directive becomes an implicit `text` block,
 * and the same applies after a terminator. Unknown directive names are kept
 * as-is; the renderer treats them as plain text and warns.
 */

export interface RzBlock {
  /** directive name without the leading `#` (e.g. `text`, `media`, `ad`, …) */
  name: string
  /** raw body lines of the block (terminator/directive lines excluded) */
  lines: string[]
}

const DIRECTIVE = /^#([A-Za-z][A-Za-z0-9_-]*)\s*$/
/** `#` alone or exactly two dashes terminate a block (three+ dashes = markdown hr). */
function isTerminator(trimmed: string): boolean {
  return trimmed === '#' || trimmed === '--'
}

export function isDirectiveLine(line: string): boolean {
  return DIRECTIVE.test(line.trim())
}

export function parseDirectives(body: string): RzBlock[] {
  const lines = String(body ?? '').split('\n')
  const blocks: RzBlock[] = []
  let current: RzBlock | null = null

  const push = (b: RzBlock | null): void => {
    if (!b) return
    // trailing blank lines carry no markdown semantics at the END of a block
    while (b.lines.length && !b.lines[b.lines.length - 1]!.trim()) b.lines.pop()
    if (b.lines.length || b.name !== 'text') blocks.push(b)
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const directive = DIRECTIVE.exec(trimmed)
    if (directive) {
      push(current)
      current = { name: directive[1] ?? 'text', lines: [] }
      continue
    }
    if (isTerminator(trimmed)) {
      push(current)
      current = null
      continue
    }
    if (!current) current = { name: 'text', lines: [] }
    current.lines.push(line)
  }
  push(current)
  return blocks
}

/** Known directive names (unknown ones degrade to plain text with a warning). */
export const KNOWN_DIRECTIVES = ['text', 'media', 'ad', 'quote', 'callout', 'source'] as const

export function isKnownDirective(name: string): boolean {
  return (KNOWN_DIRECTIVES as readonly string[]).includes(name)
}

/* ------------------------- block model builders ------------------------- */

export interface MediaItem {
  /** safe /media/… URL (already resolved; null when the name was unsafe) */
  src: string | null
  /** raw name as written in the md (for alt text / error display) */
  name: string
  caption?: string
  kind: 'image' | 'video'
}

export interface AdContent {
  image?: string | null
  alt?: string
  url: string
  label?: string
}

export interface QuoteContent {
  html: string
  source?: string
}

export interface CalloutContent {
  variant: 'info' | 'warning'
  html: string
}

export interface SourceContent {
  text: string
  url?: string
}

/** `name | caption` — one media entry per line. */
export function parseMediaLine(line: string): { name: string; caption?: string } {
  const idx = line.indexOf('|')
  const name = (idx < 0 ? line : line.slice(0, idx)).trim()
  const caption = idx < 0 ? undefined : line.slice(idx + 1).trim() || undefined
  return { name, caption }
}

export function mediaKind(name: string): 'image' | 'video' {
  return /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(name) ? 'video' : 'image'
}

/** Parse an `#ad` block: line 1 image (`img | alt`), line 2 url, line 3 label. */
export function parseAdBlock(lines: string[]): AdContent {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  const first = nonEmpty[0] ?? ''
  const hasImage = first && !/^(https?:)?\/\//i.test(first) && !first.startsWith('/')
  const img = parseMediaLine(hasImage ? first : '')
  const urlLine = hasImage ? nonEmpty[1] ?? '' : nonEmpty[0] ?? ''
  const label = (hasImage ? nonEmpty[2] : nonEmpty[1])?.trim()
  return {
    image: hasImage ? img.name : undefined,
    alt: img.caption,
    url: urlLine.trim(),
    label: label || undefined,
  }
}

/** Parse a `#quote` block: markdown lines; `| source` on the last line is optional. */
export function parseQuoteLines(lines: string[]): { md: string; source?: string } {
  const mdLines: string[] = []
  let source: string | undefined
  for (const line of lines) {
    const idx = line.indexOf('|')
    if (idx >= 0 && line.slice(0, idx).trim() === '') {
      source = line.slice(idx + 1).trim() || undefined
    } else {
      mdLines.push(line)
    }
  }
  return { md: mdLines.join('\n').trim(), source }
}

/** Parse a `#callout` block: optional first line `info|warning`, rest markdown. */
export function parseCalloutLines(lines: string[]): { variant: 'info' | 'warning'; md: string } {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean)
  let variant: 'info' | 'warning' = 'info'
  if (trimmed[0] === 'warning' || trimmed[0] === 'warn') {
    variant = 'warning'
    trimmed.shift()
  } else if (trimmed[0] === 'info') {
    trimmed.shift()
  }
  return { variant, md: trimmed.join('\n') }
}

/** Parse a `#source` block: `text | url`. */
export function parseSourceLine(line: string): SourceContent {
  const { name: text, caption } = parseMediaLine(line.trim())
  return { text, url: caption && /^https?:\/\//i.test(caption) ? caption : undefined }
}