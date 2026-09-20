import { describe, expect, it } from 'vitest'
import { fingerprint, toPersianDigits, formatMessageTime } from './format'

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
})
