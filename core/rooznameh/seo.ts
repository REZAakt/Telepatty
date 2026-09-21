/**
 * Build-time SEO for Rooznameh (pure, unit-testable — no fs, no DOM).
 *
 * Why this exists: the app is `ssr: false`, so the prerendered
 * `/rooznameh/<slug>/index.html` used to be a bare app shell — social scrapers
 * (Telegram, X, WhatsApp, Discord) that do NOT execute JS saw only generic
 * meta tags, and the article text was invisible to crawlers until JS ran.
 *
 * At generate time (`scripts/inject-rooznameh-head.ts`) each prerendered shell
 * gets, via `injectIntoShell()`:
 * - per-article `<title>`, description, canonical, Open Graph, Twitter card
 *   and `article:published_time` tags (existing generic ones are stripped so
 *   the document never carries two <title> tags),
 * - the article text as crawlable HTML inside `<div id="__nuxt">`, which the
 *   SPA replaces when it mounts (there is no hydration at all with
 *   `ssr: false`, so there are no hydration errors).
 *
 * EVERYTHING that goes into an attribute or element is escaped here — article
 * frontmatter is author input.
 */
import type { RzArticle } from './articles'

export interface SeoOriginOptions {
  /** absolute origin, e.g. https://telepatty.ir (no trailing slash) */
  origin: string
  /** baseURL ('/' or '/subpath/'), always with trailing slash */
  baseURL: string
}

/** Escape for text content AND attribute values (&, <, >, ", '). */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Strip inline markdown so crawler text is readable (links → text, images → alt). */
export function markdownToPlainText(md: string): string {
  return String(md ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])(\*|_)([^*_\n]+)\2(?=[\s).,!?:;]|$)/gm, '$1$3')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^([-*+]|\d+\.)\s+/gm, '')
}

export interface OgImageResolution {
  /** absolute URL for og:image / twitter:image */
  url: string
  /** true when the fallback (public/media/og-default.png) was used */
  fallback: boolean
  /** human-readable build warning when the cover was not usable */
  warning?: string
}

const OG_EXTENSIONS = /\.(png|jpe?g)$/i

/**
 * og:image must be an absolute PNG/JPG URL. Covers that are SVG/WebP or whose
 * file does not exist fall back to the default 1200×630 placeholder with a
 * build warning. `exists(mediaPath)` checks the build output (fs at generate
 * time, injectable for tests).
 */
export function resolveOgImage(
  article: Pick<RzArticle, 'slug' | 'cover'>,
  opts: SeoOriginOptions & { exists?: (mediaPath: string) => boolean },
): OgImageResolution {
  const base = `${opts.origin}${opts.baseURL}`
  const fallbackUrl = `${base}media/og-default.png`
  const fallback: OgImageResolution = { url: fallbackUrl, fallback: true }
  if (!article.cover) return fallback
  if (!OG_EXTENSIONS.test(article.cover)) {
    return {
      ...fallback,
      warning: `[rooznameh] ${article.slug}: og:image needs PNG/JPG — cover ${article.cover} is not usable, using media/og-default.png (add a PNG/JPG cover, ideally 1200×630).`,
    }
  }
  if (opts.exists && !opts.exists(article.cover)) {
    return {
      ...fallback,
      warning: `[rooznameh] ${article.slug}: cover ${article.cover} not found in the build output — og:image falls back to media/og-default.png.`,
    }
  }
  // covers are stored baseURL-prefixed (e.g. /tp/media/x.png) — only the
  // origin is missing, so DO NOT prefix baseURL again
  return { url: `${opts.origin}${article.cover}`, fallback: false }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const FULL_ISO_RE = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?$/

/**
 * `article:published_time` — timezone-stable ISO. A plain `YYYY-MM-DD`
 * frontmatter date means midnight UTC (deterministic across build machines);
 * a full ISO date passes through; anything else falls back to the parsed ms.
 */
function publishedTime(article: Pick<RzArticle, 'date' | 'dateText'>): string {
  if (DATE_ONLY_RE.test(article.dateText)) return `${article.dateText}T00:00:00Z`
  if (FULL_ISO_RE.test(article.dateText)) return article.dateText.replace(' ', 'T')
  return new Date(article.date).toISOString()
}

function canonicalFor(article: Pick<RzArticle, 'slug'>, opts: SeoOriginOptions): string {
  return `${opts.origin}${opts.baseURL}rooznameh/${article.slug}/`
}

/** The <head> tags for one article. Values are escaped; never raw frontmatter. */
export function articleHeadHtml(
  article: RzArticle,
  opts: SeoOriginOptions & { exists?: (p: string) => boolean },
): string {
  const title = article.title
  const description = article.description || title
  const canonical = canonicalFor(article, opts)
  const image = resolveOgImage(article, opts)
  const published = publishedTime(article)
  const meta = (attrs: string) => `    <meta ${attrs}>`
  return [
    `    <title>${escapeHtml(title)}</title>`,
    meta(`name="description" content="${escapeHtml(description)}"`),
    `    <link rel="canonical" href="${escapeHtml(canonical)}">`,
    meta(`property="og:site_name" content="Telepatty"`),
    meta(`property="og:title" content="${escapeHtml(title)}"`),
    meta(`property="og:description" content="${escapeHtml(description)}"`),
    meta(`property="og:type" content="article"`),
    meta(`property="og:url" content="${escapeHtml(canonical)}"`),
    meta(`property="og:image" content="${escapeHtml(image.url)}"`),
    meta(`property="article:published_time" content="${escapeHtml(published)}"`),
    meta(`name="twitter:card" content="summary_large_image"`),
    meta(`name="twitter:title" content="${escapeHtml(title)}"`),
    meta(`name="twitter:description" content="${escapeHtml(description)}"`),
    meta(`name="twitter:image" content="${escapeHtml(image.url)}"`),
    ...(image.warning ? [`    <!-- ${escapeHtml(image.warning)} -->`] : []),
  ].join('\n')
}

/** Generic <head> tags for the /rooznameh/ index page. */
export function listHeadHtml(opts: SeoOriginOptions): string {
  const canonical = `${opts.origin}${opts.baseURL}rooznameh/`
  const title = 'Rooznameh — Telepatty'
  const description = 'The Telepatty magazine: articles and announcements from the serverless messenger.'
  const ogImage = `${opts.origin}${opts.baseURL}media/og-default.png`
  const meta = (attrs: string) => `    <meta ${attrs}>`
  return [
    `    <title>${escapeHtml(title)}</title>`,
    meta(`name="description" content="${escapeHtml(description)}"`),
    `    <link rel="canonical" href="${escapeHtml(canonical)}">`,
    meta(`property="og:site_name" content="Telepatty"`),
    meta(`property="og:title" content="${escapeHtml(title)}"`),
    meta(`property="og:description" content="${escapeHtml(description)}"`),
    meta(`property="og:type" content="website"`),
    meta(`property="og:url" content="${escapeHtml(canonical)}"`),
    meta(`property="og:image" content="${escapeHtml(ogImage)}"`),
    meta(`name="twitter:card" content="summary_large_image"`),
    meta(`name="twitter:title" content="${escapeHtml(title)}"`),
    meta(`name="twitter:description" content="${escapeHtml(description)}"`),
    meta(`name="twitter:image" content="${escapeHtml(ogImage)}"`),
  ].join('\n')
}

/* ------------------------- crawlable article body ------------------------- */

const HEADING_RE = /^\s{0,3}#{1,6}\s+/

/** Text blocks → crawlable HTML (escaped; links/images → their text/alt). */
function textBlockHtml(lines: string[], out: string[]): void {
  let para: string[] = []
  const flush = () => {
    if (!para.length) return
    out.push(`  <p>${escapeHtml(markdownToPlainText(para.join('\n')).trim())}</p>`)
    para = []
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (HEADING_RE.test(line)) {
      flush()
      out.push(`  <h3>${escapeHtml(markdownToPlainText(line).trim())}</h3>`)
      continue
    }
    para.push(line)
  }
  flush()
}

/**
 * The article text as static, crawlable HTML. Kept deliberately minimal and
 * fully escaped (no links are emitted — hrefs are validated for the SPA only);
 * the client replaces this block when the magazine route mounts.
 */
export function articleBodyHtml(article: RzArticle): string {
  const out: string[] = []
  const date = new Date(article.date)
  const meta = [date.toISOString().slice(0, 10), `${article.readingMinutes} min`, article.author].filter(Boolean).join(' · ')
  out.push('  <h1>' + escapeHtml(article.title) + '</h1>')
  out.push('  <p><em>' + escapeHtml(meta) + '</em></p>')
  if (article.description) out.push('  <p><strong>' + escapeHtml(article.description) + '</strong></p>')
  for (const block of article.blocks) {
    if (block.name === 'text' || (!['media', 'ad', 'quote', 'callout', 'source'].includes(block.name))) {
      textBlockHtml(block.lines, out)
    } else if (block.name === 'quote') {
      out.push('  <blockquote>' + escapeHtml(markdownToPlainText(block.lines.join(' ')).trim()) + '</blockquote>')
    } else if (block.name === 'callout') {
      const [first = '', ...rest] = block.lines
      const body = (/^(info|warning)$/i.test(first.trim()) ? rest : block.lines).join(' ')
      out.push('  <p><strong>' + escapeHtml(markdownToPlainText(body).trim()) + '</strong></p>')
    } else if (block.name === 'source') {
      out.push('  <p><em>' + escapeHtml(markdownToPlainText(block.lines.join(' ')).trim()) + '</em></p>')
    }
    // #media / #ad are visual blocks — the SPA renders them after load.
  }
  if (article.tags.length) {
    out.push('  <p><em>' + escapeHtml(article.tags.map((t) => `#${t}`).join(' ')) + '</em></p>')
  }
  return [
    '<div id="tp-rz-seo" style="max-width:44rem;margin:0 auto;padding:1.5rem;font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;line-height:1.7">',
    ...out,
    '</div>',
  ].join('\n')
}

/* --------------------------- injection into shell -------------------------- */

const SHELL_HEAD_NOISE: RegExp[] = [
  /<title>[\s\S]*?<\/title>/i,
  /<meta[^>]+name=["']description["'][^>]*>/i,
  /<meta[^>]+property=["']og:[^>]*>/gi,
  /<meta[^>]+name=["']twitter:[^>]*>/gi,
  /<link[^>]+rel=["']canonical["'][^>]*>/i,
  /<meta[^>]+property=["']article:[^>]*>/gi,
  // a previous injection pass (keeps the script idempotent)
  /<div id=["']tp-rz-seo["'][^>]*>[\s\S]*?<\/div>/g,
]

/**
 * Rewrite a prerendered shell: drop the generic head tags, add the article's,
 * and place the crawlable body inside the app root (`#__nuxt`) so the SPA
 * replaces it on mount. Idempotent: running twice re-strips and re-injects.
 */
export function injectIntoShell(shell: string, headHtml: string, bodyHtml: string): string {
  let out = shell
  for (const re of SHELL_HEAD_NOISE) out = out.replace(re, '')
  out = out.replace('</head>', `${headHtml}\n  </head>`)
  const rootOpen = /(<div id=["']__nuxt["'][^>]*>)/i
  if (rootOpen.test(out)) {
    out = out.replace(rootOpen, `$1\n${bodyHtml}`)
  } else {
    out = out.replace('<body>', `<body>\n${bodyHtml}`)
  }
  return out
}
