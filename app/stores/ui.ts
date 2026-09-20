import { defineStore } from 'pinia'
import { setUiStoreRef } from '../services/messenger'
import { useContactsStore } from './contacts'
import { useSettingsStore } from './settings'
import { useChatsStore } from './chats'
import type { Envelope } from '~~/core/protocol'

function short(pk: string): string {
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : ''
}

async function notify(opts: { title: string; body: string; chatId: string }): Promise<void> {
  const { useNotifications } = await import('../composables/useNotifications')
  await useNotifications().show(opts)
}

async function setBadge(n: number): Promise<void> {
  const { useNotifications } = await import('../composables/useNotifications')
  await useNotifications().setBadge(n)
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    transportStatus: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
    webrtcStatus: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
    directPeers: [] as string[],
    online: true,
    /** single-tab lock */
    isMainTab: true,
    tabChecked: false,
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
        notifyIncoming: (env: Envelope) => void self.onIncoming(env),
        notifyFriendRequest: (env: Envelope) => void self.onFriendRequest(env),
        notifyFriendAccepted: (env: Envelope) => void self.onFriendAccepted(env),
      })
    },
    async onIncoming(env: Envelope): Promise<void> {
      const contacts = useContactsStore()
      const settings = useSettingsStore()
      const hidden = document.hidden || document.visibilityState === 'hidden'
      if (!hidden) return
      const name = contacts.displayName(env.from)
      const body = settings.notifHideContent ? '· · ·' : env.body ?? ''
      await notify({ title: name, body, chatId: env.from })
      await this.updateBadge()
    },
    async onFriendRequest(env: Envelope): Promise<void> {
      await notify({ title: env.name ?? short(env.from), body: 'friend request', chatId: '' })
      await this.updateBadge()
    },
    async onFriendAccepted(env: Envelope): Promise<void> {
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

