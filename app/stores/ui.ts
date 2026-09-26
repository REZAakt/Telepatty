import { defineStore } from 'pinia'
import { setUiStoreRef } from '../services/messenger'
import { useContactsStore } from './contacts'
import { useSettingsStore } from './settings'
import { useChatsStore } from './chats'
import type { Envelope } from '~~/core/protocol'

function short(pk: string): string {
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : ''
}

/** i18n without component context (this store lives outside setup()). */
function tSafe(key: string, params?: Record<string, unknown>): string {
  try {
    return (useNuxtApp().$i18n as unknown as { t: (k: string, p?: Record<string, unknown>) => string }).t(key, params)
  } catch {
    return key
  }
}

async function notify(opts: { title: string; body: string; chatId: string }): Promise<void> {
  const { useNotifications } = await import('../composables/useNotifications')
  await useNotifications().show(opts)
}

async function setBadge(n: number): Promise<void> {
  const { useNotifications } = await import('../composables/useNotifications')
  await useNotifications().setBadge(n)
}

async function sounds(): Promise<ReturnType<typeof import('../composables/useSounds').useSounds>> {
  const { useSounds } = await import('../composables/useSounds')
  return useSounds()
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    transportStatus: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
    webrtcStatus: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
    directPeers: [] as string[],
    /** navigator.onLine — seeded at boot, kept fresh by the online/offline events */
    online: true,
    /** single-tab lock */
    isMainTab: true,
    updateReady: false,
    badge: 0,
    /** hash invite captured at startup (#/add?...) */
    pendingInvite: null as string | null,
  }),
  actions: {
    bindMessenger(): void {
      const self = this
      setUiStoreRef({
        get transportStatus() {
          return self.transportStatus
        },
        set transportStatus(v: 'disconnected' | 'connecting' | 'connected') {
          self.transportStatus = v
        },
        get webrtcStatus() {
          return self.webrtcStatus
        },
        set webrtcStatus(v: 'disconnected' | 'connecting' | 'connected') {
          self.webrtcStatus = v
        },
        get directPeers() {
          return self.directPeers
        },
        set directPeers(v: string[]) {
          self.directPeers = v
        },
        notifyIncoming: (env: Envelope, live?: boolean) => void self.onIncoming(env, live),
        notifyFriendRequest: (env: Envelope) => void self.onFriendRequest(env),
        notifyFriendAccepted: (env: Envelope) => void self.onFriendAccepted(env),
      })
    },
    /**
     * A chat envelope landed. `live === false` means the Nostr transport handed
     * it over as mailbox catch-up (published while this device was closed or
     * offline): the unread badge/chats list still move, but nothing rings, toasts
     * or pops a system notification for history the user could not have answered.
     */
    async onIncoming(env: Envelope, live = true): Promise<void> {
      const contacts = useContactsStore()
      const settings = useSettingsStore()
      const chats = useChatsStore()
      await this.updateBadge()
      if (!live) return
      // user opt-out: no message notifications at all (Settings → Permissions)
      if (!settings.notifMessages) return
      // the chat the user is currently reading never notifies
      if (chats.openChatId === env.from) return
      const name = contacts.displayName(env.from)
      // honest preview: file metadata instead of nothing, hidden content stays hidden
      const rawBody = env.file ? `${env.file.name}` : env.body ?? ''
      const body = settings.notifHideContent ? '· · ·' : rawBody || tSafe('notifications.newMessage')
      // distinct message-received sound (iPhone/iMessage-style) — different from
      // the system `alert` used for friend requests/updates
      await (await sounds()).playIncoming()
      // in-app banner/toast with a tap-to-open action (works while the tab is visible)
      try {
        const toast = useToast()
        toast.add({
          title: name || short(env.from),
          description: body,
          color: 'primary',
          icon: 'i-lucide-message-square',
          actions: [{ label: tSafe('common.open'), onClick: () => void navigateTo(`/chat/${env.from}`) }],
        })
      } catch {
        /* no toast context (e.g. early boot) — the badge still updates */
      }
      // system notification only when the tab is NOT visible (no push server:
      // works while the app is open/alive in the background, honestly)
      const hidden = document.hidden || document.visibilityState === 'hidden'
      if (hidden) await notify({ title: name || short(env.from), body, chatId: env.from })
    },
    async onFriendRequest(env: Envelope): Promise<void> {
      await (await sounds()).playAlert()
      await notify({ title: env.name ?? short(env.from), body: 'friend request', chatId: '' })
      await this.updateBadge()
    },
    async onFriendAccepted(env: Envelope): Promise<void> {
      await (await sounds()).playAlert()
      await notify({ title: env.name ?? short(env.from), body: 'accepted your request', chatId: '' })
      await this.updateBadge()
    },
    async updateBadge(): Promise<void> {
      const unread = useChatsStore().totalUnread
      this.badge = unread
      await setBadge(unread)
    },
  },
})

