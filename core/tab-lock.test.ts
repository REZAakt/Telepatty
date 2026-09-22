import { describe, expect, it, vi } from 'vitest'
import { acquireTabLock, TAB_LOCK_NAME, type TabLockManager } from './tab-lock'

/**
 * LockManager double. The real API always calls the callback asynchronously;
 * calling it synchronously here is the harsher case (it proves the helper does
 * not depend on any await ordering).
 */
function fakeLocks(opts: { contended?: boolean; reject?: boolean } = {}): TabLockManager {
  return {
    request: (_name, _options, callback) => {
      if (opts.reject) return Promise.reject(new Error('lock manager refused'))
      return Promise.resolve(callback(opts.contended ? null : { name: TAB_LOCK_NAME }))
    },
  }
}

/** silence the intentional console.error of the throwing-startup case */
function muteConsole(): () => void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => spy.mockRestore()
}

describe('acquireTabLock', () => {
  /**
   * THE regression test: awaiting the helper used to hang forever, which made
   * the boot plugin never resolve and left the app a blank page.
   */
  it('resolves true as soon as the lock is ours — never waiting for the hold', async () => {
    const onAcquired = vi.fn()
    await expect(acquireTabLock(fakeLocks(), onAcquired)).resolves.toBe(true)
    await Promise.resolve()
    expect(onAcquired).toHaveBeenCalledTimes(1)
  })

  it('keeps holding the lock after resolving (the callback never settles)', async () => {
    let held: Promise<void> | undefined
    const locks: TabLockManager = {
      request: (_name, _options, callback) => {
        held = callback({ name: TAB_LOCK_NAME })
        return Promise.resolve()
      },
    }
    await expect(acquireTabLock(locks, () => {})).resolves.toBe(true)
    const state = await Promise.race([held!.then(() => 'settled'), Promise.resolve('held')])
    expect(state).toBe('held')
  })

  it('resolves false when another tab holds the lock, and starts nothing', async () => {
    const onAcquired = vi.fn()
    await expect(acquireTabLock(fakeLocks({ contended: true }), onAcquired)).resolves.toBe(false)
    expect(onAcquired).not.toHaveBeenCalled()
  })

  it('degrades to the main tab when Web Locks is missing', async () => {
    await expect(acquireTabLock(null, vi.fn())).resolves.toBe(true)
    await expect(acquireTabLock(undefined, vi.fn())).resolves.toBe(true)
  })

  it('degrades to the main tab when the LockManager itself refuses', async () => {
    const restore = muteConsole()
    const onAcquired = vi.fn()
    await expect(acquireTabLock(fakeLocks({ reject: true }), onAcquired)).resolves.toBe(true)
    await Promise.resolve()
    restore()
    expect(onAcquired).toHaveBeenCalledTimes(1)
  })

  it('a throwing startup keeps the main-tab outcome (and the lock)', async () => {
    const restore = muteConsole()
    const result = await acquireTabLock(fakeLocks(), () => {
      throw new Error('transport boom')
    })
    restore()
    expect(result).toBe(true)
  })

  it('contends on the documented lock name', async () => {
    let seen = ''
    const locks: TabLockManager = {
      request: (name, options, callback) => {
        seen = name
        expect(options.ifAvailable).toBe(true)
        return Promise.resolve(callback(null))
      },
    }
    await acquireTabLock(locks, () => {})
    expect(seen).toBe('telepatty-main')
    expect(TAB_LOCK_NAME).toBe('telepatty-main')
  })
})
