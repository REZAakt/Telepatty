import { computed, readonly, ref } from 'vue'

/**
 * Central permissions composable. Never requests on page load — only after a
 * user gesture. Live state updates via navigator.permissions change events.
 *
 * States are the REAL browser states:
 * - `granted` / `denied` — decided (a denied permission must be re-enabled in
 *   the browser's site settings; JS cannot re-prompt).
 * - `default` — undecided, can be requested.
 * - `not-granted` — persistent storage NOT granted: the browser decides on its
 *   own (installing the app and using it regularly helps); we only call
 *   `navigator.storage.persist()` from an explicit user gesture and never nag.
 * - `insecure` — the API needs https/localhost and this page is not secure.
 * - `unsupported` — the API does not exist in this browser.
 */
export type PermName = 'notifications' | 'camera' | 'persistent-storage' | 'clipboard'
export type PermState = 'granted' | 'denied' | 'default' | 'unsupported' | 'insecure' | 'not-granted'

const SNOOZE_KEY = 'perm-notif-snooze'

/** getUserMedia / Notification / StorageManager need a secure context. */
export const insecureContext = (): boolean =>
  typeof window !== 'undefined' && window.isSecureContext === false

export const usePermissions = () => {
  const states = ref<Record<PermName, PermState>>({
    notifications: 'unsupported',
    camera: 'unsupported',
    'persistent-storage': 'unsupported',
    clipboard: 'unsupported',
  })
  /** navigator.storage.estimate() for the storage row (bytes). */
  const usage = ref<{ usage: number; quota: number } | null>(null)

  const secure = computed(() => !insecureContext())

  const mapPerm = (p: PermissionStatus | undefined): PermState => {
    if (!p) return 'unsupported'
    return p.state as PermState
  }

  const queryOne = async (name: string): Promise<PermissionStatus | undefined> => {
    if (!import.meta.client || !navigator.permissions) return undefined
    try {
      return await navigator.permissions.query({ name: name as PermissionName })
    } catch {
      return undefined // Safari: TypeError for unsupported names
    }
  }

  const refresh = async (): Promise<void> => {
    if (!import.meta.client) return
    const insecure = insecureContext()

    // notifications (Notification.permission is the real source of truth)
    if (typeof Notification !== 'undefined') states.value.notifications = Notification.permission
    else states.value.notifications = insecure ? 'insecure' : 'unsupported'

    // camera: Permissions API where available; Safari has no camera query but
    // getUserMedia works → report requestable ('default') instead of a lie
    const cam = await queryOne('camera')
    if (cam) states.value.camera = mapPerm(cam)
    else if (!navigator.mediaDevices?.getUserMedia) states.value.camera = insecure ? 'insecure' : 'unsupported'
    else states.value.camera = 'default'

    // clipboard: same Safari fallback via feature detection
    const clip = await queryOne('clipboard-write')
    if (clip) states.value.clipboard = mapPerm(clip)
    else if (!navigator.clipboard?.writeText) states.value.clipboard = insecure ? 'insecure' : 'unsupported'
    else states.value.clipboard = 'default'

    // persistent storage: navigator.storage.persisted() is the real state
    if (!navigator.storage?.persisted) states.value['persistent-storage'] = insecure ? 'insecure' : 'unsupported'
    else {
      try {
        const persisted = await navigator.storage.persisted()
        states.value['persistent-storage'] = persisted ? 'granted' : 'not-granted'
      } catch {
        states.value['persistent-storage'] = 'unsupported'
      }
    }

    // usage/quota (shown in the Permissions Center)
    try {
      const est = await navigator.storage?.estimate?.()
      if (est) usage.value = { usage: est.usage ?? 0, quota: est.quota ?? 0 }
    } catch {
      /* ignore */
    }
  }

  /** Whether an "Enable" button makes sense at all for this permission. */
  const canRequest = (name: PermName): boolean => {
    const s = states.value[name]
    if (s === 'granted' || s === 'denied' || s === 'unsupported' || s === 'insecure') return false
    return true // 'default' (and persistent storage may flip to granted)
  }

  const watchAll = async (): Promise<() => void> => {
    const unsubs: (() => void)[] = []
    for (const name of ['camera', 'clipboard-write', 'persistent-storage'] as const) {
      const st = await queryOne(name)
      if (st) {
        const onChange = () => void refresh()
        st.onchange = onChange
        unsubs.push(() => {
          st.onchange = null
        })
      }
    }
    return () => unsubs.forEach((u) => u())
  }

  const requestNotifications = async (): Promise<PermState> => {
    const { useNotifications } = await import('./useNotifications')
    const res = await useNotifications().request()
    await refresh()
    return res === 'unsupported' ? 'unsupported' : (res as PermState)
  }

  const requestCamera = async (): Promise<PermState> => {
    if (!import.meta.client || !navigator.mediaDevices?.getUserMedia) {
      return insecureContext() ? 'insecure' : 'unsupported'
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      stream.getTracks().forEach((t) => t.stop())
      await refresh()
      return 'granted'
    } catch {
      await refresh()
      return 'denied'
    }
  }

  /**
   * Ask the browser to make storage persistent. The BROWSER decides — this can
   * legitimately answer "not granted" (regular use / installed app usually
   * flips it later). Never called automatically; only from a user gesture, and
   * the UI explains the outcome instead of nagging.
   */
  const requestPersistentStorage = async (): Promise<PermState> => {
    if (!import.meta.client || !navigator.storage?.persist) return 'unsupported'
    try {
      const granted = await navigator.storage.persist()
      await refresh()
      return granted ? 'granted' : 'not-granted'
    } catch {
      await refresh()
      return 'not-granted'
    }
  }

  const notifSnoozed = (): boolean => {
    if (!import.meta.client) return true
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0)
    return until > Date.now()
  }

  const snoozeNotif = (days = 4): void => {
    if (!import.meta.client) return
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000))
  }

  return {
    states: readonly(states),
    usage: readonly(usage),
    secure,
    canRequest,
    refresh,
    watchAll,
    requestNotifications,
    requestCamera,
    requestPersistentStorage,
    notifSnoozed,
    snoozeNotif,
  }
}
