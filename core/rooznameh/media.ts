/**
 * Safe /media URL resolution for Rooznameh content.
 *
 * Articles may only reference files under `public/media` (served at
 * `<baseURL>media/…`). Bare file names and `sub/dir/file.ext` are allowed;
 * `../` escapes, absolute external URLs and control characters are rejected.
 */
const MEDIA_ROOT = 'media/'

export function cleanMediaName(raw: string): string | null {
  let s = String(raw ?? '').trim()
  if (!s) return null
  // strip control chars & bidi overrides (same hardening as chat file names)
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  s = s.replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, '')
  s = s.split('?')[0]!.split('#')[0]! // no query/hash in local media paths
  if (s.startsWith('//')) return null // protocol-relative external URL
  if (/(^|\/)\.\.($|\/)/.test(s)) return null // no traversal
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null // no schemes (http:, data:, …)
  // strip a leading /media/ (or ./ or /) — we re-root everything under media/
  s = s.replace(/^\.?\//, '').replace(/^media\//i, '')
  if (!s || s.endsWith('/')) return null
  // allow only expected media characters; filenames stay simple
  if (!/^[\w\-. /]+\.[A-Za-z0-9]{1,8}$/.test(s)) return null
  return s
}

/** Resolve to a browser URL under the app base path; null when unsafe. */
export function resolveMediaUrl(raw: string, baseURL = '/'): string | null {
  const name = cleanMediaName(raw)
  if (!name) return null
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return `${base}${MEDIA_ROOT}${name}`
}