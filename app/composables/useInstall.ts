/**
 * Install UX: capture beforeinstallprompt, detect platform/standalone, snooze
 * rules. Desktop gets no banner by design — only a Settings entry.
 *
 * MODULE-LEVEL SINGLETON (a bug fix, not a style choice):
 * `useInstall()` used to build FRESH refs on every call, so `capture()` — called
 * once from the boot plugin — filled a THROWAWAY instance while the layout and
 * `InstallBanner` read their own, always-false refs. `ready` therefore stayed
 * `false` and `shouldShowBanner` could never become true: the install guide was
 * never shown on a phone (the reported «اول باید صفحهٔ نصب رو نمایش بده که
 * نمیده»). The state now lives ONCE at module scope, so the boot capture and
 * every component observe the SAME refs.
 */
const KEY_DISMISS_COUNT = 'install-dismiss-count'
const KEY_SNOOZE_UNTIL = 'install-snooze-until'

/**
 * Service-worker updater, registered by UpdateWatcher right after
 * `virtual:pwa-register` hands it over. Module scope on purpose so Settings →
 * Install (and the app-level toast) reach the SAME updater the watcher registered.
 */
let swUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

/* --------------------------- shared singleton state --------------------------- */
const deferred = ref<BeforeInstallPromptEvent | null>(null)
const installed = ref(false)
const standalone = ref(false)
const isIOS = ref(false)
const isMobile = ref(false)
const isAndroid = ref(false)
const ready = ref(false)
/** `capture()` must attach its window listeners exactly once per page. */
let captured = false
/**
 * Snooze state as REFS, not raw localStorage reads: the guide must disappear the
 * instant the user taps "Later", and a computed that only reads localStorage
 * never re-evaluates (its reactive deps did not change), so the modal and the
 * chip stayed on screen until the next unrelated update.
 */
const snoozedUntil = ref(0)
const dismissCount = ref(0)

/** Pull the persisted snooze state into the reactive refs. */
const readSnooze = (): void => {
  if (!import.meta.client) return
  snoozedUntil.value = Number(localStorage.getItem(KEY_SNOOZE_UNTIL) ?? 0)
  dismissCount.value = Number(localStorage.getItem(KEY_DISMISS_COUNT) ?? 0)
}

const readStandalone = (): boolean => {
  if (!import.meta.client) return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

const detect = (): void => {
  if (!import.meta.client) return
  standalone.value = readStandalone()
  installed.value = standalone.value
  const ua = navigator.userAgent
  isIOS.value = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  isAndroid.value = /Android/.test(ua)
  isMobile.value = isIOS.value || isAndroid.value || window.matchMedia('(pointer: coarse)').matches
  readSnooze()
  ready.value = true
}

/**
 * Detect the platform NOW and keep listening for the browser's install prompt.
 * Idempotent: safe to call from the boot plugin, a component and a click handler
 * (listeners attach once, detection always re-runs).
 */
const capture = (): void => {
  if (!import.meta.client) return
  detect()
  if (captured) return
  captured = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred.value = e as BeforeInstallPromptEvent
    ready.value = true
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
    clearSnooze()
  })
  // listen for display-mode changes (installed → standalone)
  window.matchMedia('(display-mode: standalone)').addEventListener('change', detect)
}

/* ------------------------------ actions ------------------------------ */

/** Handed over by UpdateWatcher once the service worker is registered. */
const registerUpdate = (fn: ((reloadPage?: boolean) => Promise<void>) | null): void => {
  swUpdate = fn
}

/**
 * Apply a pending update: let the fresh service worker take over and reload.
 * Falls back to a plain reload so the action is never a dead end (dev runs
 * without a SW, so `updateReady` stays false there and this is unreachable).
 */
const applyUpdate = async (): Promise<void> => {
  if (!import.meta.client) return
  if (!swUpdate) {
    window.location.reload()
    return
  }
  await swUpdate(true).catch(() => window.location.reload())
}

const canPrompt = computed(() => !!deferred.value)
const supported = computed(() => canPrompt.value || isIOS.value)

/** Whether the mobile install guide should be offered now (never on desktop, never when installed). */
const shouldShowBanner = computed(() => {
  if (!ready.value || standalone.value || installed.value) return false
  if (!isMobile.value) return false
  if (dismissCount.value >= 3) return false
  return Date.now() >= snoozedUntil.value
})

const dismiss = (snoozeDays = 5): void => {
  if (!import.meta.client) return
  dismissCount.value += 1
  snoozedUntil.value = Date.now() + snoozeDays * 86_400_000
  localStorage.setItem(KEY_DISMISS_COUNT, String(dismissCount.value))
  localStorage.setItem(KEY_SNOOZE_UNTIL, String(snoozedUntil.value))
}

const clearSnooze = (): void => {
  dismissCount.value = 0
  snoozedUntil.value = 0
  if (!import.meta.client) return
  localStorage.removeItem(KEY_DISMISS_COUNT)
  localStorage.removeItem(KEY_SNOOZE_UNTIL)
}

/** Trigger the browser install prompt. */
const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unsupported'> => {
  if (!deferred.value) return 'unsupported'
  await deferred.value.prompt()
  const choice = await deferred.value.userChoice
  deferred.value = null
  return choice.outcome === 'accepted' ? 'accepted' : 'dismissed'
}

export const useInstall = () => ({
  installed: readonly(installed),
  standalone: readonly(standalone),
  isIOS: readonly(isIOS),
  isAndroid: readonly(isAndroid),
  isMobile: readonly(isMobile),
  canPrompt: readonly(canPrompt),
  supported: readonly(supported),
  shouldShowBanner: readonly(shouldShowBanner),
  capture,
  detect,
  dismiss,
  clearSnooze,
  promptInstall,
  registerUpdate,
  applyUpdate,
})
