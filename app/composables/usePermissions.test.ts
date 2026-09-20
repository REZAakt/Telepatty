import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from './usePermissions'

/** Fake PermissionStatus with change support. */
function makeStatus(initial: string) {
  const listeners: (() => void)[] = []
  const st = {
    state: initial,
    onchange: null as (() => void) | null,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    _emit: () => {
      st.onchange?.()
      listeners.forEach((l) => l())
    },
  }
  return st
}

function installMocks(permission: 'default' | 'granted' | 'denied', requestResult: NotificationPermission) {
  const camera = makeStatus('granted')
  let current: NotificationPermission = permission
  vi.stubGlobal('Notification', {
    get permission() {
      return current
    },
    requestPermission: vi.fn(async () => {
      current = requestResult
      return current
    }),
  })
  Object.defineProperty(window.navigator, 'permissions', {
    configurable: true,
    value: {
      query: async (desc: { name: string }) => (desc.name === 'camera' ? camera : undefined),
    },
  })
  Object.defineProperty(window.navigator, 'storage', {
    configurable: true,
    value: {
      persist: vi.fn(async () => true),
      persisted: vi.fn(async () => true),
    },
  })
  return camera
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('usePermissions', () => {
  it('reports notification state before any request', async () => {
    installMocks('default', 'default')
    const perms = usePermissions()
    await perms.refresh()
    expect(perms.states.value.notifications).toBe('default')
    expect(perms.states.value.camera).toBe('granted')
    expect(perms.states.value['persistent-storage']).toBe('granted')
  })

  it('requests notifications after a user gesture', async () => {
    installMocks('default', 'granted')
    const perms = usePermissions()
    const res = await perms.requestNotifications()
    expect(res).toBe('granted')
    expect(perms.states.value.notifications).toBe('granted')
  })

  it('snoozes the notification banner', () => {
    installMocks('default', 'default')
    const perms = usePermissions()
    expect(perms.notifSnoozed()).toBe(false)
    perms.snoozeNotif(4)
    expect(perms.notifSnoozed()).toBe(true)
  })

  it('reflects camera permission changes via watchAll', async () => {
    const camera = installMocks('default', 'default')
    const perms = usePermissions()
    await perms.refresh()
    const unwatch = await perms.watchAll()
    expect(perms.states.value.camera).toBe('granted')
    camera.state = 'denied'
    camera._emit()
    await new Promise((r) => setTimeout(r, 10))
    expect(perms.states.value.camera).toBe('denied')
    unwatch()
  })


  it('reports unsupported when APIs are missing', async () => {
    vi.stubGlobal('Notification', undefined)
    Object.defineProperty(window.navigator, 'permissions', { configurable: true, value: undefined })
    const perms = usePermissions()
    await perms.refresh()
    expect(perms.states.value.notifications).toBe('unsupported')
  })
})

