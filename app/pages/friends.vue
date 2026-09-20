<script setup lang="ts">
import { buildInviteLink, parseInvite } from '~~/core/invites'
import { npubEncode } from '~~/core/crypto'

const identity = useIdentityStore()
const contacts = useContactsStore()
const settings = useSettingsStore()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()


const route = useRoute()
const tab = ref<'friends' | 'invite' | 'requests'>(route.query.tab === 'requests' ? 'requests' : 'friends')


const inviteLink = computed(() => {
  if (!identity.pk || !import.meta.client) return ''
  const base = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '')
  return buildInviteLink(base, identity.pk, identity.displayName, settings.relays.slice(0, 2))
})
const code = computed(() => npubEncode(identity.pk))

const copy = async (text: string, key: string) => {
  await navigator.clipboard?.writeText(text).catch(() => {})
  toast.add({ title: t(`friends.${key}`), color: 'neutral' })
}

const share = async () => {
  if (navigator.share) {
    await navigator.share({ title: 'Telepatty', text: identity.displayName, url: inviteLink.value }).catch(() => {})
  } else {
    toast.add({ title: t('friends.noShare'), color: 'neutral' })
  }
}

const paste = ref('')
const scannerOpen = ref(false)

const addFromCode = async (input: string) => {
  const res = parseInvite(input.trim())
  if (!res.ok) {
    toast.add({ title: t('friends.invalidInvite'), color: 'error' })
    return
  }
  if (res.invite.pubkey === identity.pk) {
    toast.add({ title: t('friends.selfInvite'), color: 'warning' })
    return
  }
  if (contacts.friendPks.has(res.invite.pubkey)) {
    toast.add({ title: t('friends.alreadyFriend'), color: 'neutral' })
    return
  }
  await router.push({ path: '/add', query: { k: npubEncode(res.invite.pubkey), n: res.invite.name ?? '', r: res.invite.relays?.join(',') ?? '', v: '1' } })

}

const submitPaste = () => void addFromCode(paste.value)
const onScanned = (text: string) => void addFromCode(text)

const accept = async (pk: string) => {
  const req = contacts.requests.find((r) => r.pk === pk)
  await contacts.ensureFriend(pk, req?.name)
  await contacts.removeRequest(pk)
  await getMessenger()?.sendFriendAccept(pk, identity.displayName)
  toast.add({ title: t('friends.accept'), color: 'success' })
}

const decline = async (pk: string) => {
  await contacts.removeRequest(pk)
  await getMessenger()?.sendFriendDecline(pk)
}

const cancelRequest = async (pk: string) => {
  await contacts.removeRequest(pk)
}

const ignore = (pk: string) => void contacts.removeRequest(pk)

const blockFromRequest = async (pk: string) => {
  await contacts.block(pk, false)
  toast.add({ title: t('friends.block'), color: 'neutral' })
}

function shortPk(pk: string): string {
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : ''
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
    <UTabs
      v-model="tab"
      :items="[
        { value: 'friends', label: t('nav.friends'), icon: 'i-lucide-users' },
        { value: 'invite', label: t('friends.myInvite'), icon: 'i-lucide-qr-code' },
        { value: 'requests', label: `${t('friends.requests')} (${contacts.requests.length})`, icon: 'i-lucide-user-plus' },
      ]"
    />

    <!-- FRIENDS -->
    <div v-if="tab === 'friends'" class="flex flex-col gap-2">
      <div class="flex gap-2">
        <UInput v-model="paste" :placeholder="t('friends.pasteCode')" class="flex-1" @keydown.enter="submitPaste" />
        <UButton icon="i-lucide-qr-code" :label="t('friends.scanQr')" variant="soft" @click="scannerOpen = true" />
        <UButton icon="i-lucide-plus" :label="t('friends.addFriend')" color="primary" :disabled="!paste.trim()" @click="submitPaste" />
      </div>

      <div v-if="!contacts.friends.length" class="flex-1 flex flex-col items-center gap-2 opacity-70 py-14 text-center">
        <UIcon name="i-lucide-users" class="text-4xl" />
        <p class="font-semibold">{{ t('friends.empty') }}</p>
        <p class="text-sm text-dimmed max-w-xs">{{ t('friends.emptyHint') }}</p>
      </div>

      <div v-for="f in contacts.friends" :key="f.pk" class="tp-panel p-2 flex items-center gap-3">
        <Avatar :pk="f.pk" :name="contacts.displayName(f.pk)" :size="40" />
        <div class="flex-1 min-w-0">
          <p class="truncate font-medium">{{ contacts.displayName(f.pk) }}</p>
          <p class="tp-mono text-xs text-dimmed">{{ f.verified ? '✓ ' : '' }}{{ f.pk.slice(0, 12) }}…</p>
        </div>
        <UButton icon="i-lucide-message-square" variant="ghost" size="sm" :to="`/chat/${f.pk}`" :aria-label="t('nav.chats')" />
        <UDropdownMenu
          :items="[
            [
              { label: t('friends.rename'), icon: 'i-lucide-pencil', onSelect: () => router.push(`/chat/${f.pk}`) },

              { label: t('friends.block'), icon: 'i-lucide-ban', onSelect: () => contacts.block(f.pk, false) },
            ],
          ]"
        >
          <UButton icon="i-lucide-more-vertical" variant="ghost" size="sm" :aria-label="t('common.edit')" />
        </UDropdownMenu>
      </div>
    </div>

    <!-- MY INVITE -->
    <div v-else-if="tab === 'invite'" class="flex flex-col items-center gap-3">
      <p class="text-xs text-dimmed text-center max-w-sm">{{ t('friends.inviteHint') }}</p>
      <div class="tp-panel p-4">
        <QrCode :text="inviteLink" :size="220" />
      </div>
      <div class="grid grid-cols-2 gap-2 w-full max-w-sm">
        <UButton :label="t('friends.copyLink')" icon="i-lucide-link" color="primary" block @click="copy(inviteLink, 'copyLink')" />
        <UButton :label="t('friends.share')" icon="i-lucide-share-2" variant="soft" block @click="share" />
        <UButton :label="t('friends.copyCode')" icon="i-lucide-copy" variant="soft" block class="col-span-2" @click="copy(code, 'copyCode')" />
      </div>
      <div class="tp-panel p-2 w-full max-w-sm">
        <p class="text-xs text-dimmed mb-1">{{ t('friends.code') }}</p>
        <p class="tp-mono text-xs break-all" dir="ltr">{{ code }}</p>
      </div>
    </div>

    <!-- REQUESTS -->
    <div v-else class="flex flex-col gap-2">
      <template v-if="contacts.incomingRequests.length">
        <p class="text-sm text-dimmed">{{ t('friends.incoming') }}</p>
        <div v-for="r in contacts.incomingRequests" :key="r.pk" class="tp-panel p-2 flex items-center gap-2">
          <Avatar :pk="r.pk" :name="r.name" :size="36" />
          <div class="flex-1 min-w-0">
            <p class="truncate">{{ r.name || shortPk(r.pk) }}</p>
            <p class="tp-mono text-[10px] text-dimmed">{{ r.pk.slice(0, 12) }}…</p>
          </div>
          <UButton size="xs" color="primary" :label="t('friends.accept')" @click="accept(r.pk)" />
          <UButton size="xs" variant="ghost" color="neutral" :label="t('friends.decline')" @click="decline(r.pk)" />
          <UDropdownMenu :items="[[{ label: t('friends.ignore'), onSelect: () => ignore(r.pk) }, { label: t('friends.block'), onSelect: () => blockFromRequest(r.pk) }]]">
            <UButton size="xs" variant="ghost" icon="i-lucide-more-vertical" :aria-label="t('common.edit')" />
          </UDropdownMenu>
        </div>
      </template>
      <template v-if="contacts.outgoingRequests.length">
        <p class="text-sm text-dimmed mt-2">{{ t('friends.outgoing') }}</p>
        <div v-for="r in contacts.outgoingRequests" :key="r.pk" class="tp-panel p-2 flex items-center gap-2">
          <Avatar :pk="r.pk" :name="r.name" :size="36" />
          <div class="flex-1 min-w-0">
            <p class="truncate">{{ r.name || shortPk(r.pk) }}</p>
            <p class="tp-mono text-[10px] text-dimmed">{{ t('friends.pendingOut') }}</p>
          </div>
          <UButton size="xs" variant="ghost" color="neutral" :label="t('friends.cancelRequest')" @click="cancelRequest(r.pk)" />
        </div>
      </template>
      <div v-if="!contacts.requests.length" class="text-center text-sm text-dimmed py-10">{{ t('chats.empty') }}</div>
    </div>

    <QrScanner v-model:open="scannerOpen" @scanned="onScanned" />
  </div>
</template>

