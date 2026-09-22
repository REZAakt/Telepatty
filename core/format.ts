export interface Fingerprint {
  groups: string[]
  combined: string
}

/**
 * Safety-number style fingerprint: two keys are mixed with SHA-256 and rendered
 * as 6 groups of 5 digits (0-99 pad) so users can compare out-of-band.
 */
export async function fingerprint(myPk: string, theirPk: string): Promise<Fingerprint> {
  const pair = [myPk, theirPk].sort().join(':')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pair)))
  let num = 0n
  for (let i = 0; i < 10; i++) num = (num << 8n) | BigInt(digest[i] ?? 0)

  const digits = num.toString().padStart(30, '0').slice(0, 30)
  const groups: string[] = []
  for (let i = 0; i < 6; i++) groups.push(digits.slice(i * 5, i * 5 + 5).padStart(5, '0'))
  return { groups, combined: digits }
}

export function toPersianDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d)
}


export interface DateOpts {
  locale: 'fa' | 'en'
  jalali: boolean
  persianDigits: boolean
}

/**
 * BCP-47 tag that PINS the calendar and the numbering system instead of letting
 * the locale inherit them. This is what makes the two settings real:
 * `fa-IR` already defaults to the Persian calendar AND to Persian digits, so the
 * old tags (`fa-IR`, `fa-IR-u-ca-persian`, `fa-IR-u-nu-arabext`) produced
 * IDENTICAL output for `jalali: false` and `persianDigits: false` — turning both
 * switches into no-ops for exactly the language that ships them. Every locale
 * now always states both axes explicitly.
 */
export function dateLocale(opts: DateOpts): string {
  const base = opts.locale === 'fa' ? 'fa-IR' : 'en-US'
  const cal = opts.jalali ? 'persian' : 'gregory'
  const nu = opts.persianDigits ? 'arabext' : 'latn'
  return `${base}-u-ca-${cal}-nu-${nu}`
}

/** A Persian-calendar date in a non-Persian locale carries an era ("…, 1402 AP") — drop it. */
const ERA_SUFFIX = /\s+(?:AP|AD|AH|BE|CE|BC|BCE)$/i

/** Format a date part-by-part; era tokens are removed so "1402 AP" never shows up. */
function formatDate(tag: string, ts: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(tag, options).format(new Date(ts)).replace(ERA_SUFFIX, '')
}

/** Human time: HH:MM for today, short date otherwise. Honors Jalali + Persian digits. */
export function formatMessageTime(ts: number, opts: DateOpts): string {
  const tag = dateLocale(opts)
  const d = new Date(ts)
  const today = new Date()
  const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(d)
  if (d.toDateString() === today.toDateString()) return time
  const date = formatDate(tag, ts, { year: 'numeric', month: 'short', day: 'numeric' })
  return `${date} ${time}`
}

export function formatDateSeparator(ts: number, opts: DateOpts): string {
  return formatDate(dateLocale(opts), ts, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Compact numeric date as `YYYY/MM/DD` in the selected calendar and digits —
 * no month names, no weekday. The order is assembled from `formatToParts()`
 * instead of trusting the locale's own order (`en-US` would emit MM/DD/YYYY),
 * so a list of dates always reads the same way in both languages.
 */
export function formatNumericDate(ts: number, opts: DateOpts): string {
  const parts = new Intl.DateTimeFormat(dateLocale(opts), { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(ts),
  )
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}/${get('month')}/${get('day')}`
}

export function relativeTime(ts: number, locale: 'fa' | 'en', persianDigits = false): string {
  const diff = Date.now() - ts
  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { numeric: 'auto' })
  const mins = Math.round(diff / 60_000)
  const out = Math.abs(mins) < 60 ? rtf.format(-mins, 'minute') : rtf.format(-Math.round(diff / 3_600_000), 'hour')
  return persianDigits ? toPersianDigits(out) : out
}
