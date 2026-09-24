import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildArticle, normalizeCategories } from './articles'
import { parseAdBlock, parseMediaLine } from './directives'
import { cleanMediaName } from './media'
import { splitFrontmatter } from './frontmatter'
import { listArticles } from './sitemap'

/**
 * Publishing guard for the magazine's assets.
 *
 * Rooznameh shipped with "placeholder screenshot" / "replace with
 * /media/<your-cover>" wireframes and one article pointed at them, so a reader
 * (and every social preview) saw authoring notes instead of artwork. The art is
 * hand-made SVG now, and this test keeps it that way:
 * - every file an article references (cover, `#media` entries, the `#ad` image)
 *   must EXIST under `public/media` (a missing file renders a placeholder card);
 * - no SVG under `public/media` may contain the word "placeholder" or an
 *   authoring instruction — that is exactly what "ready to publish" means.
 *
 * It reads the same frontmatter/directive parsers the app uses, so it fails on
 * a typo in an article, not on a copy of the content.
 */
const CONTENT = join(process.cwd(), 'content/rooznameh')
const MEDIA = join(process.cwd(), 'public/media')

const categories = normalizeCategories(splitFrontmatter(readFileSync(join(CONTENT, '_categories.md'), 'utf8')).data)

/** every asset file name one article points at (cover + `#media` + `#ad`) */
function referencedFiles(slug: string): string[] {
  const { article } = buildArticle(slug, readFileSync(join(CONTENT, `${slug}.md`), 'utf8'), categories)
  if (!article) return []
  const names: string[] = []
  if (article.cover) names.push(article.cover)
  for (const block of article.blocks) {
    if (block.name === 'media') {
      for (const line of block.lines) {
        const trimmed = line.trim()
        if (trimmed) names.push(parseMediaLine(trimmed).name)
      }
    }
    if (block.name === 'ad') {
      const ad = parseAdBlock(block.lines)
      if (ad.image) names.push(ad.image)
    }
  }
  return names
}

describe('magazine assets are real, present and publishable', () => {
  const slugs = listArticles(CONTENT).map((a) => a.slug)

  it('has published articles to check (never passes by finding nothing)', () => {
    expect(slugs.length).toBeGreaterThan(0)
  })

  it('every image/video an article references exists under public/media', () => {
    for (const slug of slugs) {
      const refs = referencedFiles(slug)
      expect(refs.length, `${slug} references no media at all`).toBeGreaterThan(0)
      for (const name of refs) {
        const clean = cleanMediaName(name)
        expect(clean, `${slug}: unsafe media name "${name}"`).not.toBeNull()
        expect(existsSync(join(MEDIA, clean!)), `${slug}: public/media/${clean} is missing`).toBe(true)
      }
    }
  })

  it('no SVG under public/media is a leftover placeholder or authoring note', () => {
    const svgs = readdirSync(MEDIA).filter((f) => f.toLowerCase().endsWith('.svg'))
    expect(svgs.length).toBeGreaterThan(0)
    for (const file of svgs) {
      const text = readFileSync(join(MEDIA, file), 'utf8').toLowerCase()
      expect(text.includes('placeholder'), `public/media/${file} still says "placeholder"`).toBe(false)
      expect(text.includes('replace with /media'), `public/media/${file} still carries an authoring note`).toBe(false)
    }
  })

  it('every SVG in public/media is well-formed and scalable', () => {
    const parser = new DOMParser()
    const svgs = readdirSync(MEDIA).filter((f) => f.toLowerCase().endsWith('.svg'))
    for (const file of svgs) {
      const doc = parser.parseFromString(readFileSync(join(MEDIA, file), 'utf8'), 'image/svg+xml')
      const error = doc.querySelector('parsererror')
      expect(error?.textContent ?? null, `public/media/${file} is not valid XML`).toBeNull()
      expect(doc.documentElement.tagName.toLowerCase(), `public/media/${file}`).toBe('svg')
      // without a viewBox the browser cannot scale it and crops the art instead
      expect(doc.documentElement.getAttribute('viewBox'), `public/media/${file} has no viewBox`).toBeTruthy()
    }
  })
})
