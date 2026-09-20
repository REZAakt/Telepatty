import { gatherGuardsFor, shouldTypeToFocus } from '~~/core/focus'

/**
 * Type-to-focus for the chat screen: a printable character typed while no
 * editable is focused moves focus into the composer so the character flows
 * into it (works for Persian input; skipped during IME composition).
 * Attach on the chat page; remove on unmount.
 */
export function useTypeToFocus(target: () => HTMLElement | null | undefined) {
  function resolveElement(): HTMLElement | null {
    const el = target()
    if (!el) return null
    if (el.matches('input, textarea')) return el
    return el.querySelector<HTMLElement>('input, textarea') ?? (el as HTMLElement)
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (!import.meta.client) return
    const composer = resolveElement()
    if (!composer || document.activeElement === composer) return
    if (!shouldTypeToFocus(e, gatherGuardsFor(document.activeElement))) return
    composer.focus()
    // the default action then inserts the character into the composer
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
  return { onKeydown }
}
