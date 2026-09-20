import { computed, readonly, ref } from 'vue'

/**
 * Central permissions composable. Never requests on page load — only after a
 * user gesture. Live state updates via navigator.permissions change events.
 */
export type PermName = 'notifications' | 'camera' | 'persistent-storage' | 'clipboard'
export type PermState = 'granted' | 'denied' | 'default' | 'unsupported'


const SNOOZE_KEY = 'perm-notif-snooze'

export const usePermissions = () => {
  const states = ref<Record<PermName, PermState>>({
    notifications: 'unsupported',
    camera: 'unsupported',
    'persistent-storage': 'unsupported',
    clipboard: 'unsupported',
  })

  const mapPerm = (p: PermissionStatus | undefined): PermState => {
    if (!p) return 'unsupported'
    return p.state as PermState
  }

  const queryOne = async (name: string): Promise<PermissionStatus | undefined> => {
    if (!import.meta.client || !navigator.permissions) return undefined
    try {
      return await navigator.permissions.query({ name: name as PermissionName })
    } catch {
      return undefined
    }
  }

  const refresh = async (): Promise<void> => {
    if (!import.meta.client) return
    // notifications
    if (typeof Notification !== 'undefined') states.value.notifications = Notification.permission
    else states.value.notifications = 'unsupported'

    // camera via permissions API (or unsupported)
    const cam = await queryOne('camera')
    states.value.camera = cam ? mapPerm(cam) : 'unsupported'
    // clipboard
    const clip = await queryOne('clipboard-write')
    states.value.clipboard = clip ? mapPerm(clip) : 'unsupported'
    // persistent storage: real answer via estimate/persisted
    states.value['persistent-storage'] = typeof navigator.storage?.persist === 'function' ? 'default' : 'unsupported'

    try {
      const persisted = await navigator.storage?.persisted?.()
      if (persisted !== undefined) states.value['persistent-storage'] = persisted ? 'granted' : 'default'
    } catch {
      /* ignore */
    }
  }

  const watchAll = async (): Promise<() => void> => {
    const unsubs: (() => void)[] = []
    for (const name of ['camera'] as const) {
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
    if (!import.meta.client || !navigator.mediaDevices?.getUserMedia) return 'unsupported'
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

  const requestPersistentStorage = async (): Promise<PermState> => {
    if (!import.meta.client || !navigator.storage?.persist) return 'unsupported'
    try {
      const granted = await navigator.storage.persist()
      await refresh()
      return granted ? 'granted' : 'denied'
    } catch {
      return 'denied'
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
    refresh,
    watchAll,
    requestNotifications,
    requestCamera,
    requestPersistentStorage,
    notifSnoozed,
    snoozeNotif,
  }
}
