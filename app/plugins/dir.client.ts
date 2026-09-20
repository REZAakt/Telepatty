/**
 * Earliest possible direction fix for SPA cold start: settings live in Dexie
 * (async), so the pre-paint inline script in `nuxt.config.ts` seeds <html> from
 * the localStorage mirror. This plugin re-applies it as soon as Nuxt boots —
 * still before the app renders — and keeps working if the mirror was missing.
 * The reactive part then lives in `useHtmlDir` (app.vue).
 */
export default defineNuxtPlugin(() => {
  let lang: 'en' | 'fa' = 'en'
  try {
    lang = localStorage.getItem('tp.lang') === 'fa' ? 'fa' : 'en'
  } catch {
    /* default to LTR/en */
  }
  const el = document.documentElement
  el.setAttribute('lang', lang === 'fa' ? 'fa-IR' : 'en')
  el.setAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr')
})
