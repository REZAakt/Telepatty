/** Path of the app icon inside `public/` (also the 512x512 PWA icon). */
export const APP_ICON_PATH = 'icons/icon-512.png'

/**
 * Absolute URL of the app icon — one source for the brand mark (header,
 * onboarding) so it can never drift from `nuxt.config.ts` (favicon/apple-touch)
 * or the PWA manifest. Base-path aware, exactly like the head links.
 */
export function useAppIcon(): string {
  const baseURL = useRuntimeConfig().app.baseURL || '/'
  return `${baseURL}${APP_ICON_PATH}`
}
