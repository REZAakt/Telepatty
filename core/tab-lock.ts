/**
 * Single-tab lock (Web Locks API). ONE place owns the subtle part: the promise
 * must settle as soon as the OUTCOME is known, while the lock itself stays held
 * by a callback that intentionally never returns.
 *
 * REGRESSION (blank white page): the boot plugin wrapped the lock request in a
 * helper and `await`ed it, but that helper resolved only AFTER
 *
 *     await startAsMain()
 *     await new Promise<void>(() => {})   // ← the hold: never settles
 *
 * On every browser that exposes `navigator.locks` the callback therefore
 * acquired the lock, started the transports and never settled — so the awaited
 * async Nuxt PLUGIN never resolved either. Nuxt mounts the app only after its
 * plugins resolve, so the screen stayed blank while the app was actually
 * running behind it. RESOLVE FIRST, hold afterwards.
 */

/** The slice of `LockManager` this module needs (injectable so tests can pass a fake). */
export interface TabLockManager {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>
}

/** Lock name every tab of this account contends for. */
export const TAB_LOCK_NAME = 'telepatty-main'

/**
 * Try to become the main tab.
 *
 * @param locks      `navigator.locks` (or a fake); a missing implementation
 *                   degrades to `true` so the app is never blocked.
 * @param onAcquired runs once the lock is OURS (start transports etc.). It runs
 *                   in the background — the returned promise never waits for it,
 *                   and a throw/rejection there can neither change the outcome
 *                   nor release the lock (a rejecting lock callback WOULD
 *                   release it).
 * @returns `true` when this tab owns the lock (held until the page closes),
 *          `false` when another tab already holds it.
 */
export function acquireTabLock(
  locks: TabLockManager | null | undefined,
  onAcquired: () => void | Promise<void>,
): Promise<boolean> {
  if (!locks) return Promise.resolve(true)
  /** never let a failure in the main-tab startup escape into the lock callback */
  const runOnAcquired = async (): Promise<void> => {
    try {
      await onAcquired()
    } catch (e) {
      console.error('[telepatty] main-tab start failed', e)
    }
  }
  return new Promise<boolean>((resolve) => {
    locks
      .request(TAB_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false)
          return
        }
        // settle BEFORE holding — see the regression note above
        resolve(true)
        await runOnAcquired()
        // hold until the tab closes; releasing this unblocks the other tabs
        await new Promise<void>(() => {})
      })
      .catch(() => {
        // the LockManager itself refused (older engine, rejected name): degrade
        // to the main tab, the app must still boot and run its transports
        resolve(true)
        void runOnAcquired()
      })
  })
}
