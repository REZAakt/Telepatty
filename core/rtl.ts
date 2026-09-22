/**
 * Direction / layout-side constants. ONE place controls which physical side
 * chat bubbles occupy so the behaviour is easy to audit and to change.
 *
 * Telegram-like: outgoing bubbles stay on the PHYSICAL right and incoming on
 * the physical left in BOTH LTR and RTL. This is deliberately a physical
 * (not logical) rule — logical classes would mirror the bubbles in RTL, which
 * Telegram does not do.
 */
export const BUBBLE_SIDE = 'physical-right' as const

/**
 * Physical side classes for the bubble row container. `ml-auto`/`mr-auto` are
 * physical on purpose (see BUBBLE_SIDE); the grep test allowlists exactly
 * these. An auto margin only resolves on a box with a DEFINITE width, which is
 * why MessageBubble pairs them with `w-full max-w-[85%]`: on a full-width
 * `width: auto` box CSS 2.1 §10.3.3 collapses the auto margin to 0 and the side
 * silently falls back to the ambient document direction.
 */
export function bubbleSideClasses(mine: boolean): string {
  return mine ? 'ml-auto mr-0' : 'ml-0 mr-auto'
}

/**
 * `dir` for the MessageBubble root: it pins the whole bubble subtree to the
 * PHYSICAL (LTR) inline axis, so the row's `flex-row-reverse` (own bubble) and
 * the `bubbleSideClasses()` margins mean the same physical side in en (ltr) and
 * fa (rtl).
 *
 * ROOT CAUSE of the "own messages jump to the LEFT in Persian" bug: a flex row
 * packs along its main axis and BOTH `row` and `row-reverse` start at the row's
 * inline start — which mirrors together with `<html dir="rtl">`. The physical
 * margins could not compensate because they sat on a `width: auto` block box
 * (see above), so in fa the own bubbles landed on the left and the peer's on the
 * right — exactly mirrored. Locking the subtree to ltr makes fa render
 * identically to en.
 *
 * Message text is unaffected: every bubble keeps its own `dir="auto"`, so a
 * Persian message still reads right-to-left, on either side.
 */
export const BUBBLE_LAYOUT_DIR = 'ltr' as const

/** Which physical side the navigation sidebar is expected to sit on. */
export function sidebarSideForDir(dir: 'rtl' | 'ltr'): 'left' | 'right' {
  return dir === 'rtl' ? 'right' : 'left'
}

/** <html lang> value per app locale. */
export function langTagForLocale(locale: 'en' | 'fa'): string {
  return locale === 'fa' ? 'fa-IR' : 'en'
}

/** <html dir> value per app locale. */
export function dirForLocale(locale: 'en' | 'fa'): 'rtl' | 'ltr' {
  return locale === 'fa' ? 'rtl' : 'ltr'
}
