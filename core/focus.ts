/**
 * Pure focus-decision logic. No DOM access here — the composable
 * (`app/composables/useAutoFocus.ts`) gathers the state and calls these.
 *
 * Rules:
 * - Auto-focus ONLY on true desktop pointers: `(hover: hover) and (pointer: fine)`.
 *   On touch devices focusing an input pops up the keyboard — never do it except
 *   after the user was already typing there (see shouldFocusAfterSend).
 * - Never steal focus from an editable element, a `<select>`, a contenteditable,
 *   or while an IME composition is running.
 * - Never fight an open modal/dialog that owns its own focus management.
 * - Type-to-focus: a printable character typed outside any editable focuses the
 *   composer so the character flows into it (Persian/IME-safe).
 */

export const DESKTOP_POINTER_QUERY = '(hover: hover) and (pointer: fine)'
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export interface FocusGuards {
  /** is the currently focused element an editable (input/textarea/select/contenteditable)? */
  activeIsEditable: boolean
  /** does the document have a non-collapsed text selection (user is selecting)? */
  hasTextSelection: boolean
  /** a modal / dialog / sheet is open and manages focus itself */
  openDialog: boolean
  /** an IME composition is in progress */
  isComposing: boolean
  /** `matchMedia(DESKTOP_POINTER_QUERY).matches` */
  pointerFine: boolean
}

export const NO_FOCUS_GUARDS: FocusGuards = {
  activeIsEditable: false,
  hasTextSelection: false,
  openDialog: false,
  isComposing: false,
  pointerFine: true,
}

/** Should an automatic focus attempt be allowed at all (desktop contexts)? */
export function shouldAutoFocusDesktop(g: FocusGuards): boolean {
  if (!g.pointerFine) return false
  if (g.activeIsEditable) return false
  if (g.hasTextSelection) return false
  if (g.openDialog) return false
  if (g.isComposing) return false
  return true
}

export interface KeyEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  isComposing?: boolean
}

/** Is this keydown a plain printable character (any script, incl. Persian)? */
export function isPrintableCharKey(e: KeyEventLike): boolean {
  if (e.isComposing) return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  // length 1 covers every printable Unicode character (ASCII, ف, ü, ١, …);
  // named keys like 'ArrowUp'/'Backspace' are longer.
  return e.key.length === 1
}

/** Type-to-focus: printable char typed outside any editable, no open dialog. */
export function shouldTypeToFocus(e: KeyEventLike, g: FocusGuards): boolean {
  if (!isPrintableCharKey(e)) return false
  if (g.activeIsEditable || g.openDialog || g.isComposing) return false
  return true
}

/**
 * After sending: desktop always refocuses the composer; on touch we only keep
 * the keyboard if it was already open (composer focused) — we never open it.
 */
export function shouldFocusAfterSend(g: { composerFocused: boolean; pointerFine: boolean }): boolean {
  return g.pointerFine || g.composerFocused
}

/** Is the event target an editable element (for click-to-focus decisions)? */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  const editable = (el as HTMLElement).isContentEditable
  return editable === true
}

/** Composition state tracked globally (elements don't expose `isComposing`). */
let compositionDepth = 0
let compositionListenersInstalled = false
function ensureCompositionListeners(): void {
  if (compositionListenersInstalled || typeof document === 'undefined') return
  compositionListenersInstalled = true
  document.addEventListener('compositionstart', () => {
    compositionDepth += 1
  })
  document.addEventListener('compositionend', () => {
    compositionDepth = Math.max(0, compositionDepth - 1)
  })
}

/**
 * Gather the guards from the DOM for a given active element. This is the ONLY
 * DOM-touching part — kept tiny so the decision logic above stays pure.
 */
export function gatherGuardsFor(active: Element | null): FocusGuards {
  ensureCompositionListeners()
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  return {
    activeIsEditable: isEditableElement(active),
    hasTextSelection: !!sel && String(sel).length > 0,
    openDialog: typeof document !== 'undefined' ? !!document.querySelector('[role="dialog"], [role="alertdialog"]') : false,
    isComposing: compositionDepth > 0,
    pointerFine: typeof window !== 'undefined' ? window.matchMedia(DESKTOP_POINTER_QUERY).matches : false,
  }
}

