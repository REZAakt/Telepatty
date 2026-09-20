import { computed, watchEffect } from 'vue'
import { dirForLocale, langTagForLocale } from '~~/core/rtl'
import { useSettingsStore } from '../stores/settings'

/**
 * Single source of truth for `<html lang>` / `<html dir>`.
 *
 * Why this exists: `useLocaleHead()` never produced `dir="rtl"` because the
 * `fa` locale definition had no `dir` property, so Persian kept the LTR layout
 * (see DECISIONS.md). This composable derives both attributes reactively from
 * the settings store, applies them to `document.documentElement` directly
 * (the authoritative, instant mechanism — no reload) and mirrors the choice to
 * `localStorage['tp.lang']` so the pre-paint inline script in `nuxt.config.ts`
 * can set the right direction before the first paint on cold start.
 *
 * Vue APIs are imported explicitly so this file is unit-testable under vitest
 * (the test env has no Nuxt auto-imports).
 */
export function useHtmlDir() {
  const settings = useSettingsStore()

  const dir = computed<'rtl' | 'ltr'>(() => dirForLocale(settings.language))
  const lang = computed(() => langTagForLocale(settings.language))

  // Direct DOM write: instant, also covers SPA cold start before hydration.
  watchEffect(() => {
    if (typeof document === 'undefined') return
    const el = document.documentElement
    el.setAttribute('dir', dir.value)
    el.setAttribute('lang', lang.value)
    try {
      localStorage.setItem('tp.lang', settings.language)
    } catch {
      /* private mode etc. — the in-memory value still rules this session */
    }
  })

  // Keep unhead in sync too (title/meta ordering, devtools, any SSR use).
  // `useHead` is a Nuxt auto-import (generated globals); absent in vitest,
  // where the ReferenceError is caught and the direct DOM write above suffices.
  try {
    useHead(() => ({ htmlAttrs: { lang: lang.value, dir: dir.value } }))
  } catch {
    /* no nuxt context (unit tests) */
  }

  return { dir, lang }
}
