<script setup lang="ts">
import { parseInviteQuery } from '~~/core/invites'
import { fingerprint } from '~~/core/format'
import { getDb } from '~~/core/db'

const route = useRoute()
const router = useRouter()
const identity = useIdentityStore()
const contacts = useContactsStore()
const ui = useUiStore()
const { t } = useI18n()
const toast = useToast()

const invite = computed(() => parseInviteQuery(route.query as Record<string, unknown>))

const data = computed(() => (invite.value.ok ? invite.value.invite : null))
const isSelf = computed(() => data.value?.pubkey === identity.pk)
const already = computed(() => !!data.value && contacts.friendPks.has(data.value.pubkey))
/** a request to this person is already on its way — never stack duplicates */
const pending = computed(() => !!data.value && contacts.outgoingPending.has(data.value.pubkey))
/**
 * A bare friend code (npub) carries no display name — only a full invite link
 * does. That is expected, so say it instead of looking broken: their name
 * arrives with the request they send back (or when they accept).
 */
const noName = computed(() => !!data.value && !data.value.name)
const fp = ref<{ groups: string[] } | null>(null)
const busy = ref(false)

watchEffect(async () => {
  if (data.value) fp.value = await fingerprint(identity.pk || data.value.pubkey, data.value.pubkey)
})

const send = async () => {
  if (!data.value || busy.value) return
  busy.value = true
  try {
    // remember the relays the invite advertises: publishing the request to them
    // is what makes it land on a device configured with a DIFFERENT relay set
    await contacts.addRequest(data.value.pubkey, data.value.name, 'out', data.value.relays)
    const sent = await getMessenger()?.sendFriendRequest(data.value.pubkey, identity.displayName, data.value.relays)
    // `false`/undefined = no relay accepted it right now. The request is stored
    // and the messenger re-sends it on the next reconnect, so say that honestly
    // instead of claiming success (the reported «ریکوستی که میدی نمیرسه بهش»).
    toast.add({
      title: sent ? t('friends.sendRequest') : t('friends.requestQueued'),
      color: sent ? 'success' : 'warning',
    })
    ui.pendingInvite = null
    void router.replace('/')
  } finally {
    busy.value = false
  }
}

/** No account yet: keep the invite in storage, run onboarding, resume after. */
const savePending = async () => {
  if (data.value) {
    const q = new URLSearchParams()
    q.set('k', data.value.pubkey)
    if (data.value.name) q.set('n', data.value.name)
    if (data.value.relays?.length) q.set('r', data.value.relays.join(','))
    q.set('v', '1')
    ui.pendingInvite = q.toString()
    await getDb().settings.put({
      key: 'pendingInvite',
      value: { pk: data.value.pubkey, name: data.value.name, relays: data.value.relays },
    })
  }
  void router.replace('/onboarding')
}

function shortPk(pk: string): string {
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : ''
}

/* tab title: «افزودن دوست — Telepatty» / «Add friend — Telepatty» */
usePageTitle(() => t('friends.addFriend'))
</script>


<template>
  <div class="flex-1 flex items-center justify-center p-6">
    <div class="tp-panel p-6 max-w-md w-full flex flex-col gap-4">
      <template v-if="!data">
        <UIcon name="i-lucide-unlink" class="text-4xl text-error" />
        <p class="font-semibold">{{ t('friends.invalidInvite') }}</p>
        <p class="text-sm text-dimmed">{{ t('friends.pasteCode') }}</p>
      </template>

      <template v-else-if="isSelf">
        <UIcon name="i-lucide-user" class="text-4xl" />
        <p>{{ t('friends.selfInvite') }}</p>
      </template>

      <template v-else-if="already">
        <p>{{ t('friends.alreadyFriend') }}</p>
        <UButton :to="`/chat/${data.pubkey}`" :label="t('nav.chats')" color="primary" block />
      </template>

      <template v-else-if="pending">
        <UIcon name="i-lucide-clock" class="text-4xl text-(--tp-accent)" />
        <p class="font-semibold">{{ t('friends.alreadyRequested') }}</p>
        <p class="text-xs text-dimmed">{{ t('friends.pendingOut') }}</p>
        <UButton to="/" :label="t('common.ok')" color="primary" block />
      </template>

      <template v-else-if="!identity.exists">
        <UIcon name="i-lucide-user-plus" class="text-4xl text-(--tp-accent)" />
        <p class="font-semibold">{{ t('friends.addTitle', { name: data.name || shortPk(data.pubkey) }) }}</p>
        <p class="text-xs text-dimmed">{{ t('onboarding.welcome') }}</p>
        <UButton :label="t('onboarding.create')" color="primary" block @click="savePending" />
      </template>

      <template v-else>
        <div class="flex items-center gap-3">
          <Avatar :pk="data.pubkey" :name="data.name" :size="56" />
          <div class="min-w-0">
            <p class="font-semibold truncate">{{ data.name || shortPk(data.pubkey) }}</p>
            <p class="tp-mono text-xs text-dimmed break-all" dir="ltr">{{ data.pubkey.slice(0, 20) }}…</p>
          </div>
        </div>
        <!-- a bare friend code has no name; explain it instead of looking broken -->
        <p v-if="noName" class="text-xs text-dimmed">{{ t('friends.noNameHint') }}</p>
        <p class="text-xs text-dimmed">{{ t('friends.verifyHint') }}</p>
        <div class="grid grid-cols-3 gap-2">
          <div v-for="(g, i) in fp?.groups ?? []" :key="i" class="tp-panel p-1.5 text-center tp-mono text-sm">{{ g }}</div>
        </div>
        <UButton :label="t('friends.addConfirm')" color="primary" block :loading="busy" :disabled="busy" @click="send" />
        <UButton :label="t('common.cancel')" variant="ghost" block :to="'/'" />
      </template>
    </div>
  </div>
</template>

