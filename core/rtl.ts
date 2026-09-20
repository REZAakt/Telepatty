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
 * Physical side classes for a message bubble row inside a `flex flex-col`
 * container. `ml-auto`/`mr-auto` are physical on purpose (see BUBBLE_SIDE);
 * the grep test allowlists exactly these.
 */
export function bubbleSideClasses(mine: boolean): string {
  return mine ? 'ml-auto mr-0' : 'ml-0 mr-auto'
}

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
