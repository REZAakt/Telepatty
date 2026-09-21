import { getDb } from '~~/core/db'

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
  ui.tabChecked = false

  const settings = useSettingsStore()
  await settings.load()
  if (settings.language === 'fa') {
    const i18n = useNuxtApp().$i18n as unknown as { locale: { value: string } }
    i18n.locale.value = 'fa'
  }

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
    if (!path.startsWith('/onboarding') && !path.startsWith('/add')) {
      await router.replace('/onboarding')
    }
  } else if (identity.locked && !path.startsWith('/lock')) {
    await router.replace('/lock')
  } else if (path.startsWith('/onboarding') || path.startsWith('/lock')) {
    await router.replace('/')
  }

  // start transports only when identity is usable
  if (identity.ready) {
    const { createMessenger, getMessenger } = await import('../services/messenger')
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

    // single-tab lock: only the main tab runs transports/pipelines
    try {
      const nav = navigator as Navigator & { locks?: LockManager }
      void nav.locks?.request('telepatty-main', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          ui.isMainTab = false
          return
        }
        ui.isMainTab = true
        // hold until page unloads
        await new Promise<void>(() => {})
      })
    } catch {
      ui.isMainTab = true
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

    // install capture + notification click routing
    useInstall().capture()
    useNotifications().navigateFromNotification()

    // storage persistence warning (permission is requested later, after backup)
    try {
      const persisted = await navigator.storage?.persisted?.()
      if (persisted === false) {
        // shown in Permissions Center; also surface once as toast
        const toast = useToast()
        toast.add({ title: 'Storage', description: 'best-effort', color: 'warning' })
      }
    } catch {
      /* ignore */
    }
  }

  void getDb
})
