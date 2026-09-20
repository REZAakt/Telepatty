import { gatherGuardsFor, shouldAutoFocusDesktop } from '~~/core/focus'

/**
 * `v-autofocus-desktop`: focuses the element on mount — ONLY on true desktop
 * pointers (`(hover: hover) and (pointer: fine)`). Touch devices never get an
 * automatic keyboard. Usage: `<UInput v-autofocus-desktop ... />`.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('autofocus-desktop', {
    mounted(el: HTMLElement) {
      if (!import.meta.client) return
      if (!shouldAutoFocusDesktop(gatherGuardsFor(document.activeElement))) return
      const target = el.matches('input, textarea') ? el : el.querySelector<HTMLElement>('input, textarea')
      const focusEl = target ?? el
      // wait a tick so the element is visible and (in dialogs) the sheet is open
      requestAnimationFrame(() => {
        focusEl.focus({ preventScroll: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
      })
    },
  })
})
