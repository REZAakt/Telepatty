/**
 * Install UX: capture beforeinstallprompt, detect platform/standalone, snooze
 * rules. Desktop gets no banner by design — only a Settings entry.
 */
const KEY_DISMISS_COUNT = 'install-dismiss-count'
const KEY_SNOOZE_UNTIL = 'install-snooze-until'

export const useInstall = () => {
  const deferred = ref<(Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null>(null)
  const installed = ref(false)
  const standalone = ref(false)
  const isIOS = ref(false)
  const isMobile = ref(false)
  const isAndroid = ref(false)
  const ready = ref(false)

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
    ready.value = true
  }

  const capture = (): void => {
    if (!import.meta.client) return
    detect()
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      deferred.value = e as never
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

  const canPrompt = computed(() => !!deferred.value)
  const supported = computed(() => canPrompt.value || isIOS.value)

  /** Whether the mobile banner should show now (never on desktop, never when installed). */
  const shouldShowBanner = computed(() => {
    if (!ready.value || standalone.value || installed.value) return false
    if (!isMobile.value) return false
    const snooze = Number(localStorage.getItem(KEY_SNOOZE_UNTIL) ?? 0)
    const dismissed = Number(localStorage.getItem(KEY_DISMISS_COUNT) ?? 0)
    if (dismissed >= 3) return false
    return Date.now() >= snooze
  })

  const dismiss = (snoozeDays = 5): void => {
    if (!import.meta.client) return
    const count = Number(localStorage.getItem(KEY_DISMISS_COUNT) ?? 0) + 1
    localStorage.setItem(KEY_DISMISS_COUNT, String(count))
    localStorage.setItem(KEY_SNOOZE_UNTIL, String(Date.now() + snoozeDays * 86_400_000))
  }

  const clearSnooze = (): void => {
    if (!import.meta.client) return
    localStorage.removeItem(KEY_DISMISS_COUNT)
    localStorage.removeItem(KEY_SNOOZE_UNTIL)
  }

  /** Trigger the browser install prompt. */
  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unsupported'> => {
    if (!deferred.value) return isIOS.value ? 'unsupported' : 'unsupported'
    await deferred.value.prompt()
    const choice = await deferred.value.userChoice
    deferred.value = null
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed'
  }

  return {
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
    promptInstall,
  }
}
