import { toValue, type MaybeRefOrGetter } from 'vue'
import { pageTitle } from '~~/core/page-title'

/**
 * Sets the browser-tab title of the current screen — the ONE way pages title
 * themselves (the layout/app fallback is just `Telepatty`).
 *
 * The name is passed as a getter/ref, so the title is live: switching the
 * language in Settings re-titles the tab (`fa`/`en` strings), and a dynamic
 * name (the peer of an open chat) follows its own store.
 *
 * `useHead` and `useI18n` are Nuxt auto-imports; the pure half of the pattern
 * lives in `core/page-title.ts` so it is unit-tested without a Nuxt context.
 */
export function usePageTitle(name: MaybeRefOrGetter<string>): void {
  const { t } = useI18n()
  useHead(() => ({ title: pageTitle(toValue(name), t('app.name')) }))
}
