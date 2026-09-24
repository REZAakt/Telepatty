import { isRef, watch } from 'vue'
import type { AppLocale } from '~~/core/prefs'
import { useSettingsStore } from '../stores/settings'

/**
 * The vue-i18n composer slice this module needs.
 *
 * `useNuxtApp().$i18n` / `useI18n()` resolve to `i18n.global` (the composer) in
 * the composition build this app uses, where `locale` is a writable ref. Older
 * / legacy setups expose the instance itself with a plain-string `locale`, so
 * both shapes are accepted and narrowed AT RUNTIME instead of being cast.
 */
export interface LocaleSwitchTarget {
  locale: unknown
  loadLocaleMessages?: (locale: string) => unknown
}

/**
 * Activate `lang` on a vue-i18n composer — LOADING ITS MESSAGES FIRST.
 *
 * ROOT CAUSE of "the app flips to RTL but every string stays English": the
 * locale used to be switched with `i18n.locale.value = 'fa'` alone (once in
 * `plugins/init.client.ts`, once in the settings page). @nuxtjs/i18n v10 ships
 * locale JSON through `localeLoaders`: the messages are merged into the
 * composer only by `loadLocaleMessages()` / `setLocale()` (its own
 * `plugins/i18n.js` and `route-locale-detect.js` do exactly that). Setting the
 * ref on its own leaves `fa` with NO messages, so every `t()` resolves through
 * `fallbackLocale: 'en'` (`i18n/vue-i18n.config.ts`) — Persian layout, English
 * words. Loading the messages and THEN switching is the whole fix; the order
 * matters, hence the sequential `await` (a unit test pins it).
 *
 * @returns `true` when the target was usable (and now shows `lang`).
 */
export async function activateLocale(target: unknown, lang: AppLocale): Promise<boolean> {
  if (!target || typeof target !== 'object') return false
  const i18n = target as LocaleSwitchTarget
  const locale = i18n.locale
  const current = isRef(locale) ? locale.value : locale
  // no usable locale on this target (missing i18n, unit-test stub, legacy shape)
  if (typeof current !== 'string') return false
  // already active: its messages were loaded when it became active
  if (current === lang) return true
  try {
    await i18n.loadLocaleMessages?.(lang)
  } catch (e) {
    // a loader failure must never break the language switch itself — the
    // remaining keys then fall back one by one
    console.warn(`[telepatty] i18n: loading "${lang}" messages failed`, e)
  }
  if (isRef(locale)) {
    locale.value = lang
  } else {
    i18n.locale = lang
  }
  return true
}

/**
 * App-level mirror: the UI language is the STORED setting, so the settings
 * store is the single source of truth and this watcher moves the STRINGS for
 * every writer that exists now or later (settings page, backup import,
 * onboarding). It goes through `activateLocale()`, i.e. messages are loaded
 * before the locale flips — which is what used to be missing (`<html dir>`
 * followed the store while the strings stayed English).
 *
 * The cold-start case is applied earlier and awaited by
 * `plugins/init.client.ts`, so the first frame is already correct.
 */
export function useAppLocale() {
  const settings = useSettingsStore()
  const i18n = useI18n()

  watch(
    () => settings.language,
    (lang) => {
      void activateLocale(i18n, lang)
    },
    { immediate: true },
  )

  return {
    /** switch programmatically (message-loading aware, awaitable) */
    apply: (lang: AppLocale) => activateLocale(i18n, lang),
  }
}
