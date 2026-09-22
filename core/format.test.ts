import { describe, expect, it } from 'vitest'
import { fingerprint, toPersianDigits, formatMessageTime, formatDateSeparator, formatNumericDate } from './format'

describe('fingerprint', () => {
  it('is deterministic and symmetric', async () => {
    const a = '11'.repeat(32)
    const b = '22'.repeat(32)
    const f1 = await fingerprint(a, b)
    const f2 = await fingerprint(b, a)
    expect(f1.combined).toBe(f2.combined)
    expect(f1.groups).toHaveLength(6)
    expect(f1.groups.every((g) => /^\d{5}$/.test(g))).toBe(true)
    const f3 = await fingerprint(a, '33'.repeat(32))
    expect(f3.combined).not.toBe(f1.combined)
  })
})

describe('formatting', () => {
  it('converts to Persian digits', () => {
    expect(toPersianDigits('123')).toBe('۱۲۳')
  })

  it('formats message time without crashing in both locales/calendars', () => {
    const ts = new Date(2024, 0, 15, 10, 30).getTime()
    const en = formatMessageTime(ts, { locale: 'en', jalali: false, persianDigits: false })
    const faJalali = formatMessageTime(ts, { locale: 'fa', jalali: true, persianDigits: true })
    expect(en).toMatch(/10:30/)
    expect(faJalali.length).toBeGreaterThan(0)
  })

  /**
   * Regression guard: `fa-IR` inherits the Persian calendar by default, so the
   * old tags (which only appended `-u-ca-persian` when the switch was ON) made
   * the calendar setting a no-op in Persian — chat and Rooznameh looked the same
   * as Jalali and as Gregorian. The locale tag now PINS the calendar.
   * 2024-01-15 = 25 Dey 1402 (Jalali) = 15 Jan 2024 (Gregorian).
   */
  it('honors the calendar setting in both languages', () => {
    const ts = new Date(2024, 0, 15, 10, 30).getTime()
    const opts = (locale: 'fa' | 'en', jalali: boolean) => ({ locale, jalali, persianDigits: false })
    expect(formatNumericDate(ts, opts('fa', false))).toBe('2024/01/15')
    expect(formatNumericDate(ts, opts('fa', true))).toBe('1402/10/25')
    expect(formatNumericDate(ts, opts('en', false))).toBe('2024/01/15')
    expect(formatNumericDate(ts, opts('en', true))).toBe('1402/10/25')
  })

  /**
   * Same regression on the digits axis: `fa-IR` also inherits arabext digits, so
   * `persianDigits: false` used to keep showing ۰-۹. The tag now pins `-nu-latn`.
   */
  it('honors the digit setting in both languages', () => {
    const ts = new Date(2024, 0, 15, 10, 30).getTime()
    expect(formatNumericDate(ts, { locale: 'fa', jalali: true, persianDigits: true })).toBe('۱۴۰۲/۱۰/۲۵')
    expect(formatNumericDate(ts, { locale: 'fa', jalali: false, persianDigits: true })).toBe('۲۰۲۴/۰۱/۱۵')
    const latin = formatDateSeparator(ts, { locale: 'fa', jalali: true, persianDigits: false })
    expect(latin).toMatch(/[0-9]/)
    expect(latin).not.toMatch(/[۰-۹]/)
    const persian = formatDateSeparator(ts, { locale: 'fa', jalali: true, persianDigits: true })
    expect(persian).toMatch(/[۰-۹]/)
    expect(persian).not.toMatch(/[0-9]/)
  })

  it('drops the Persian-calendar era from English dates', () => {
    const ts = new Date(2024, 0, 15, 10, 30).getTime()
    expect(formatDateSeparator(ts, { locale: 'en', jalali: true, persianDigits: false })).not.toMatch(/\b(?:AP|AD)\b/)
  })
})
