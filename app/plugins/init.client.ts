import { getDb } from '~~/core/db'
import { acquireTabLock } from '~~/core/tab-lock'

function tSafeInit(key: string): string {
  try {
    // i18n without component context
    return useNuxtApp().$i18n.t(key)
  } catch {
    return key
  }
}

/** Client bootstrap: db → stores → routing gate → messenger → global listeners. */

export default defineNuxtPlugin(async () => {
  if (!import.meta.client) return
  const ui = useUiStore()
  ui.bindMessenger()

  const settings = useSettingsStore()
  await settings.load()
  // i18n follows the restored setting (no_prefix strategy — a single locale).
  // settings.language was seeded synchronously from localStorage before this
  // plugin ran, so this is never "the default clobbering the user's choice".
  try {
    const i18n = useNuxtApp().$i18n as unknown as { locale: { value: string } }
    if (i18n?.locale) i18n.locale.value = settings.language
  } catch {
    /* i18n unavailable (unit-test contexts) — the DOM lang/dir is set by useHtmlDir */
  }

  // Keep the i18n locale in LOCKSTEP with the stored language for the whole app
  // lifetime. Regression: the stored setting flipped <html dir> (the inline boot
  // script + useHtmlDir read settings.language) while the STRINGS stayed
  // English, because writers that changed settings.language — and i18n's own
  // browser-language detection — never touched the locale in between. One
  // watcher here covers the settings page, backup import and any future writer.
  watch(
    () => settings.language,
    (lang) => {
      try {
        const i18n = useNuxtApp().$i18n as unknown as { locale: { value: string } }
        if (i18n?.locale && i18n.locale.value !== lang) i18n.locale.value = lang
      } catch {
        /* i18n unavailable — useHtmlDir still keeps lang/dir correct */
      }
    },
  )

  // apply the stored appearance BEFORE the app renders (no theme flash, and
  // "reduce motion"/bubble style/colors take effect from the first frame).
  try {
    useTheme().apply()
  } catch {
    /* never block boot on theming */
  }



  const identity = useIdentityStore()
  await identity.bootstrap()
  const contacts = useContactsStore()
  await contacts.load()
  const chats = useChatsStore()
  await chats.load()

  const router = useRouter()
  const route = useRoute()
  const path = route.path

  if (!identity.exists) {
    // requirement: NOTHING is usable before the identity exists — the
    // onboarding flow is the only allowed route (the old /add exception let
    // people browse the app without an account).
    if (!path.startsWith('/onboarding')) {
      await router.replace('/onboarding')
    }
    // keep the gate up for every LATER in-app navigation too, not just boot
    router.beforeEach((to) => {
      if (!identity.exists && !to.path.startsWith('/onboarding')) return '/onboarding'
    })
  } else if (identity.locked && !path.startsWith('/lock')) {
    await router.replace('/lock')
  } else if (path.startsWith('/onboarding') || path.startsWith('/lock')) {
    await router.replace('/')
  }

  // start transports only when identity is usable
  if (identity.ready) {
    const { createMessenger, getMessenger } = await import('../services/messenger')

    // single-tab lock — REQUIRED BEFORE the transports start: a second tab of
    // the same account must never run the pipelines/signaling (duplicate
    // WebRTC signaling confuses peers and is one cause of bogus presence).
    // The full-screen TabGuard overlay replaces the old read-only warning.
    let transportsStarted = false
    const startAsMain = async (): Promise<void> => {
      if (transportsStarted) return
      transportsStarted = true
      ui.isMainTab = true
      if (!getMessenger()) {
        const m = createMessenger()
        try {
          await m.start()
        } catch (e) {
          // never crash the whole app on transport/db init — degrade to offline mode
          console.error('[telepatty] messenger start failed', e)
          useToast().add({ title: tSafeInit('errors.offline'), color: 'warning' })
        }
      }
      // install capture + notification click routing (once, with the app)
      useInstall().capture()
      useNotifications().navigateFromNotification()
    }

    const nav = navigator as Navigator & { locks?: LockManager }
    let takeoverTimer: ReturnType<typeof setInterval> | null = null
    const stopTakeoverPoll = (): void => {
      if (takeoverTimer) clearInterval(takeoverTimer)
      takeoverTimer = null
    }

    /**
     * Try to become the main tab: resolves `true` as soon as the lock is OURS
     * (it then stays held for the page lifetime) and `false` when another tab
     * holds it. The hold-forever part lives in core/tab-lock.ts (unit-tested) —
     * awaiting the hold HERE is what made this plugin never resolve, and Nuxt
     * mounts the app only after its plugins resolve (the blank-white-page bug).
     */
    const tryAcquireLock = (): Promise<boolean> => acquireTabLock(nav.locks ?? null, startAsMain)
    const gotLock = await tryAcquireLock()
    if (!gotLock) {
      // blocked: this tab shows the forced overlay until the other one closes.
      // SELF-CHECK: poll the lock every few seconds; once the other tab is
      // gone its lock is released, we acquire it, take over the transports and
      // the overlay disappears. A page REFRESH re-runs this whole boot path,
      // so a refreshed tab is correctly blocked or unblocked.
      ui.isMainTab = false
      takeoverTimer = setInterval(() => {
        void tryAcquireLock().then((ok) => {
          if (ok) stopTakeoverPoll()
        })
      }, 3_000)
    }

    // lifecycle listeners
    const onOnline = () => {
      ui.online = true
      void getMessenger()?.reconnect()
    }
    const onOffline = () => {
      ui.online = false
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void getMessenger()?.reconnect()
        void getMessenger()?.outbox?.process()
        ui.updateBadge()
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
  }

  void getDb
})
