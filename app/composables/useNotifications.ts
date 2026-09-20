/** Local notifications via the service worker (no push — app must be running). */
export interface ShowOpts {
  title: string
  body: string
  chatId?: string
}

export const useNotifications = () => {
  const supported = import.meta.client && 'Notification' in window

  const registration = async (): Promise<ServiceWorkerRegistration | null> => {
    if (!import.meta.client || !('serviceWorker' in navigator)) return null
    try {
      return (await navigator.serviceWorker.getRegistration()) ?? null
    } catch {
      return null
    }
  }

  const state = async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!supported) return 'unsupported'
    return Notification.permission
  }

  const request = async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!supported) return 'unsupported'
    try {
      return await Notification.requestPermission()
    } catch {
      return Notification.permission
    }
  }

  /** Show through the service worker when possible (click → focus chat). */
  const show = async (opts: ShowOpts): Promise<void> => {
    if (!supported || Notification.permission !== 'granted') return
    const reg = await registration()
    const payload = { body: opts.body, icon: '/icons/icon-192.png', tag: opts.chatId || 'tp', data: { chatId: opts.chatId } }
    if (reg) {
      await reg.showNotification(opts.title, payload)
    } else {
      const n = new Notification(opts.title, payload)
      n.onclick = () => {
        window.focus()
        n.close()
      }
    }
  }

  const setBadge = async (count: number): Promise<void> => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => void; clearAppBadge?: () => void }
    try {
      if (count > 0) nav.setAppBadge?.(count)
      else nav.clearAppBadge?.()
    } catch {
      /* unsupported */
    }
  }

  const navigateFromNotification = (): void => {
    if (!import.meta.client) return
    navigator.serviceWorker?.addEventListener('notificationclick', (event: Event) => {
      const e = event as NotificationEvent
      e.notification.close()
      const chatId = e.notification.data?.chatId
      event.preventDefault?.()
      if (chatId) window.location.assign(`#/chat/${chatId}`)
      else window.focus()
    })
  }

  return { supported, state, request, show, setBadge, navigateFromNotification, registration }
}
