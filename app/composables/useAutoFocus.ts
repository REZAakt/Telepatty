import { DESKTOP_POINTER_QUERY, REDUCED_MOTION_QUERY, gatherGuardsFor, shouldAutoFocusDesktop } from '~~/core/focus'

/** Current desktop-pointer / reduced-motion media state (reactive). */
export function usePointerState() {
  const pointerFine = ref(false)
  const reducedMotion = ref(false)
  if (import.meta.client) {
    const pf = window.matchMedia(DESKTOP_POINTER_QUERY)
    const rm = window.matchMedia(REDUCED_MOTION_QUERY)
    const sync = () => {
      pointerFine.value = pf.matches
      reducedMotion.value = rm.matches
    }
    sync()
    pf.addEventListener?.('change', sync)
    rm.addEventListener?.('change', sync)
  }
  return { pointerFine, reducedMotion }
}

/**
 * Desktop-only auto-focus for a target input.
 * `focusNow()` focuses the target when the guards allow it (desktop pointer,
 * nothing editable focused, no text selection, no open dialog, no IME).
 * Focus is placed without scrolling when reduced motion is on.
 */
export function useAutoFocus(target: () => HTMLElement | null | undefined) {
  const { reducedMotion } = usePointerState()

  function resolveElement(): HTMLElement | null {
    const el = target()
    if (!el) return null
    // component roots (UInput/UTextarea) wrap the real input — find it
    if (el.matches('input, textarea')) return el
    return el.querySelector<HTMLElement>('input, textarea') ?? (el as HTMLElement)
  }

  function focusNow(): void {
    if (!import.meta.client) return
    if (!shouldAutoFocusDesktop(gatherGuardsFor(document.activeElement))) return
    const el = resolveElement()
    if (!el || document.activeElement === el) return
    el.focus({ preventScroll: reducedMotion.value })
    // put the caret at the end for inputs, so typing appends
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }

  return { focusNow, resolveElement }
}
