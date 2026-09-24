import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { activateLocale } from './useAppLocale'

/**
 * Regression: "the app is RTL but every string is still English".
 *
 * `@nuxtjs/i18n` v10 delivers locale JSON through loaders; the messages land in
 * the composer only via `loadLocaleMessages()`/`setLocale()`. The old code
 * flipped `i18n.locale.value` directly, so `fa` had NO messages and every `t()`
 * fell back to `fallbackLocale: 'en'`. These tests pin the ORDER (load, then
 * flip) and the shape tolerance of the helper.
 */
describe('activateLocale (switch that actually loads messages)', () => {
  it('loads the messages BEFORE flipping the locale', async () => {
    const order: string[] = []
    const state = { current: 'en' }
    const target = {
      get locale() {
        return state.current
      },
      set locale(next: string) {
        state.current = next
        order.push(`set:${next}`)
      },
      async loadLocaleMessages(locale: string) {
        order.push(`load:${locale}`)
      },
    }

    await expect(activateLocale(target, 'fa')).resolves.toBe(true)
    // the load MUST come first — flipping first is the reported bug
    expect(order).toEqual(['load:fa', 'set:fa'])
    expect(state.current).toBe('fa')
  })

  it('switches a ref-shaped locale (the shape this app gets from useI18n)', async () => {
    const locale = ref('en')
    const load = vi.fn(async () => undefined)
    await activateLocale({ locale, loadLocaleMessages: load }, 'fa')
    expect(locale.value).toBe('fa')
    expect(load).toHaveBeenCalledWith('fa')
  })

  it('does nothing when the locale is already active', async () => {
    const locale = ref('fa')
    const load = vi.fn(async () => undefined)
    await expect(activateLocale({ locale, loadLocaleMessages: load }, 'fa')).resolves.toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(locale.value).toBe('fa')
  })

  it('keeps the switch working when the message loader rejects', async () => {
    const locale = ref('en')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(
      activateLocale({ locale, loadLocaleMessages: async () => Promise.reject(new Error('offline')) }, 'fa'),
    ).resolves.toBe(true)
    expect(locale.value).toBe('fa')
    warn.mockRestore()
  })

  it('reports failure for unusable targets (no-i18n / unit-test contexts)', async () => {
    await expect(activateLocale(undefined, 'fa')).resolves.toBe(false)
    await expect(activateLocale(null, 'fa')).resolves.toBe(false)
    await expect(activateLocale({}, 'fa')).resolves.toBe(false)
    await expect(activateLocale({ locale: 42 }, 'fa')).resolves.toBe(false)
  })
})
