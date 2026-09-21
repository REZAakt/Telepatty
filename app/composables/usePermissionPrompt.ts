import { reactive, readonly } from 'vue'
import { usePermissions, type PermName } from './usePermissions'

/**
 * One small, reusable, dismissible permission prompt (rendered ONCE by
 * `PermissionPrompt.vue` in the default layout; pages only call `suggest()`).
 *
 * No-nagging rules, enforced here so no call site can get them wrong:
 * - only shown from a real user gesture (`suggest()` is called from a click),
 * - NEVER for a permission already granted, denied, insecure or unsupported,
 * - a dismissal is remembered per permission and the prompt stays quiet for
 *   several days (`rememberDismissal`),
 * - only one prompt is ever visible (`state.open`).
 */
const DISMISS_PREFIX = 'tp.perm.prompt.'
const DEFAULT_DISMISS_DAYS = 4

export interface PermissionPromptState {
  open: boolean
  perm: PermName | null
}

/** Module-level singleton: one prompt across the whole app. */
const state = reactive<PermissionPromptState>({ open: false, perm: null })

function readDismissedUntil(name: PermName): number {
  try {
    return Number(localStorage.getItem(DISMISS_PREFIX + name) ?? 0)
  } catch {
    return Date.now() // storage unavailable → never nag
  }
}

/** Quiet for `days` after a dismissal (per permission). */
function rememberDismissal(name: PermName, days = DEFAULT_DISMISS_DAYS): void {
  try {
    localStorage.setItem(DISMISS_PREFIX + name, String(Date.now() + days * 86_400_000))
  } catch {
    /* private mode — the in-memory close() still applies */
  }
}

export const usePermissionPrompt = () => {
  const perms = usePermissions()

  const dismissedRecently = (name: PermName): boolean => readDismissedUntil(name) > Date.now()

  /**
   * Call from a user gesture (e.g. the Scan QR click). Returns `true` when the
   * prompt was shown — the caller can then WAIT (not open the dependent flow)
   * so the browser never fires its native prompt at the same time.
   */
  const suggest = async (name: PermName): Promise<boolean> => {
    if (!import.meta.client || state.open || dismissedRecently(name)) return false
    await perms.refresh()
    const s = perms.states.value[name]
    // only ask when it can actually help; granted/denied/insecure/unsupported → stay silent
    const askable = s === 'default' || (name === 'persistent-storage' && s === 'not-granted')
    if (!askable) return false
    state.perm = name
    state.open = true
    return true
  }

  /** "Not now" — remember the dismissal so we do not nag for days. */
  const dismiss = (days = DEFAULT_DISMISS_DAYS): void => {
    if (state.perm) rememberDismissal(state.perm, days)
    close()
  }

  const close = (): void => {
    state.open = false
    state.perm = null
  }

  /** "Enable" — performs the gesture-gated request and closes the prompt. */
  const accept = async (): Promise<void> => {
    const name = state.perm
    close()
    if (!name) return
    if (name === 'notifications') await perms.requestNotifications()
    else if (name === 'camera') await perms.requestCamera()
    else if (name === 'persistent-storage') await perms.requestPersistentStorage()
  }

  return { state: readonly(state), suggest, dismiss, accept, close, dismissedRecently, rememberDismissal }
}
