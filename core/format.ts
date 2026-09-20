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

/** Human time: HH:MM for today, short date otherwise. Honors Jalali + Persian digits. */
export function formatMessageTime(ts: number, opts: DateOpts): string {
  const loc = opts.locale === 'fa' ? 'fa-IR' : 'en-US'
  const cal = opts.jalali ? '-u-ca-persian' : ''
  const nu = opts.persianDigits ? '-nu-arabext' : ''
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = new Intl.DateTimeFormat(`${loc}${cal}${nu}`, { hour: '2-digit', minute: '2-digit' }).format(d)
  if (sameDay) return time
  const date = new Intl.DateTimeFormat(`${loc}${cal}${nu}`, { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
  return `${date} ${time}`
}

export function formatDateSeparator(ts: number, opts: DateOpts): string {
  const loc = opts.locale === 'fa' ? 'fa-IR' : 'en-US'
  const cal = opts.jalali ? '-u-ca-persian' : ''
  const nu = opts.persianDigits ? '-nu-arabext' : ''
  return new Intl.DateTimeFormat(`${loc}${cal}${nu}`, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(ts))
}

export function relativeTime(ts: number, locale: 'fa' | 'en', persianDigits = false): string {
  const diff = Date.now() - ts
  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { numeric: 'auto' })
  const mins = Math.round(diff / 60_000)
  const out = Math.abs(mins) < 60 ? rtf.format(-mins, 'minute') : rtf.format(-Math.round(diff / 3_600_000), 'hour')
  return persianDigits ? toPersianDigits(out) : out
}
