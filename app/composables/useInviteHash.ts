/**
 * Hash-fragment invite capture: links look like
 *   https://host/base#/add?k=<npub>&n=<name>&r=<relays>&v=1
 * The fragment never reaches the server. This composable watches location.hash,
 * stores the invite, and rewrites the URL to the SPA route /add?....
 */
export const useInviteHash = () => {
  const ui = useUiStore()
  const router = useRouter()

  const capture = (): void => {
    if (!import.meta.client) return
    const hash = window.location.hash
    if (hash.startsWith('#/add?')) {
      const q = hash.slice(6) // after '#/add?'
      ui.pendingInvite = q
      // keep data out of history; switch to a clean route
      void router.replace({ path: '/add', query: Object.fromEntries(new URLSearchParams(q)) })
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }

  const attach = (): void => {
    capture()
    if (!import.meta.client) return
    window.addEventListener('hashchange', capture)
  }

  return { capture, attach, pendingInvite: computed(() => ui.pendingInvite) }
}
