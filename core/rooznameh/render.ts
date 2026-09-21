/**
 * Markdown → sanitized HTML for Rooznameh bodies.
 *
 * `marked` parses, DOMPurify sanitizes. Only runs client-side (the magazine is
 * client-rendered, ssr:false) and in happy-dom under vitest. Sanitization is
 * strict: no scripts/iframes/styles/forms, `javascript:` URLs are dropped,
 * external links get `target="_blank" rel="noopener noreferrer"` and inline
 * images must stay under the app's `/media/…` root.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { resolveMediaUrl } from './media'

let hooked = false

function ensureHooks(baseURL: string): void {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (el.tagName === 'A' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? ''
      // authored markdown may only embed local /media images (telepatty CSP
      // has no external image hosts; external URLs would also leak reader IPs)
      if (!src || !resolveMediaUrl(src, baseURL)) {
        el.remove()
      } else {
        el.setAttribute('loading', 'lazy')
        el.setAttribute('decoding', 'async')
      }
    }
  })
}

/** Parse markdown and return sanitized HTML (empty string on any failure). */
export function renderMarkdown(md: string, baseURL = '/'): string {
  try {
    ensureHooks(baseURL)
    const raw = marked.parse(String(md ?? ''), { async: false, gfm: true, breaks: false }) as string
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'video', 'audio', 'iframe'],
      FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload'],
      ADD_ATTR: ['target', 'rel', 'loading', 'decoding'],
    })
  } catch {
    return ''
  }
}