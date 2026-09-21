import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Mocked permission state machine: the composable's no-nagging rules are what
 * we verify here (never prompt for granted/denied/unsupported/insecure,
 * remember dismissals for days, one prompt at a time).
 */
const mocks = vi.hoisted(() => {
  const fn = () => vi.fn(async () => 'granted')
  return {
    states: { value: {} as Record<string, string> },
    refresh: vi.fn(async () => {}),
    requestNotifications: fn(),
    requestCamera: fn(),
    requestPersistentStorage: fn(),
  }
})

vi.mock('./usePermissions', () => ({
  usePermissions: () => mocks,
}))

import { usePermissionPrompt } from './usePermissionPrompt'

describe('usePermissionPrompt (no nagging)', () => {
  const prompt = usePermissionPrompt()

  beforeEach(() => {
    localStorage.clear()
    prompt.close()
    mocks.states.value = {
      notifications: 'default',
      camera: 'default',
      'persistent-storage': 'not-granted',
      clipboard: 'default',
    }
    mocks.requestNotifications.mockClear()
    mocks.requestCamera.mockClear()
    mocks.requestPersistentStorage.mockClear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('never suggests for an already granted or denied permission', async () => {
    mocks.states.value.camera = 'granted'
    await expect(prompt.suggest('camera')).resolves.toBe(false)
    mocks.states.value.camera = 'denied'
    await expect(prompt.suggest('camera')).resolves.toBe(false)
    mocks.states.value.notifications = 'unsupported'
    await expect(prompt.suggest('notifications')).resolves.toBe(false)
    expect(prompt.state.open).toBe(false)
  })

  it('suggests undecided permissions and persistent storage that is not granted', async () => {
    await expect(prompt.suggest('camera')).resolves.toBe(true)
    expect(prompt.state.open).toBe(true)
    expect(prompt.state.perm).toBe('camera')
    prompt.close()
    await expect(prompt.suggest('persistent-storage')).resolves.toBe(true)
    prompt.close()
  })

  it('a dismissal is remembered for days (expired dismissals ask again)', async () => {
    await prompt.suggest('notifications')
    prompt.dismiss(4)
    expect(prompt.state.open).toBe(false)
    // quiet for days…
    await expect(prompt.suggest('notifications')).resolves.toBe(false)
    // …but a deliberately EXPIRED dismissal asks again
    prompt.rememberDismissal('notifications', -1)
    await expect(prompt.suggest('notifications')).resolves.toBe(true)
    prompt.close()
  })

  it('accept() performs the gesture-gated request and closes the prompt', async () => {
    await prompt.suggest('notifications')
    await prompt.accept()
    expect(mocks.requestNotifications).toHaveBeenCalledTimes(1)
    expect(prompt.state.open).toBe(false)
    await prompt.suggest('persistent-storage')
    await prompt.accept()
    expect(mocks.requestPersistentStorage).toHaveBeenCalledTimes(1)
  })

  it('only one prompt is visible at a time', async () => {
    await expect(prompt.suggest('camera')).resolves.toBe(true)
    await expect(prompt.suggest('notifications')).resolves.toBe(false)
    expect(prompt.state.perm).toBe('camera')
    prompt.close()
  })
})
