<script setup lang="ts">
import { fingerprint } from '~~/core/format'
import { npubEncode } from '~~/core/crypto'

const props = defineProps<{ chatId: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'export-text'): void; (e: 'export-json'): void; (e: 'delete-chat'): void; (e: 'clear-history'): void }>()

const contacts = useContactsStore()
const { t } = useI18n()
const toast = useToast()
const identity = useIdentityStore()
const router = useRouter()

const friend = computed(() => contacts.friend(props.chatId))
const fp = ref<{ groups: string[] } | null>(null)
const verifyOpen = ref(false)
const renameOpen = ref(false)
const nickname = ref('')

onMounted(async () => {
  fp.value = await fingerprint(identity.pk, props.chatId)
  nickname.value = friend.value?.nickname ?? ''
})

const muted = computed(() => !!friend.value?.mutedUntil && friend.value.mutedUntil > Date.now())

const copyCode = async () => {
  await navigator.clipboard?.writeText(npubEncode(props.chatId)).catch(() => {})
  toast.add({ title: t('common.copied'), color: 'neutral' })
}

const setVerified = async () => {
  await contacts.setVerified(props.chatId, true)
  verifyOpen.value = false
  toast.add({ title: t('friends.verified'), color: 'success' })
}

const rename = async () => {
  await contacts.rename(props.chatId, nickname.value)
  renameOpen.value = false
}

const togglePin = () => void contacts.togglePin(props.chatId)
const toggleArchive = () => {
  void contacts.toggleArchive(props.chatId)
  emit('close')
}

const mute = (hours: number) => void contacts.mute(props.chatId, hours ? Date.now() + hours * 3_600_000 : 0)

const unfriend = async () => {
  if (!confirm(t('friends.unfriendConfirm'))) return
  await contacts.unfriend(props.chatId, true)
  emit('close')
  void router.replace('/')
}

const block = async () => {
  if (!confirm(t('friends.blockConfirm'))) return
  await contacts.block(props.chatId, true)
  emit('close')
  void router.replace('/')
}

const unblock = async () => {
  await contacts.unblock(props.chatId)
  emit('close')
  void router.replace('/')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <Avatar :pk="chatId" :name="contacts.displayName(chatId)" :size="56" />
      <div class="min-w-0">
        <p class="font-semibold truncate">{{ contacts.displayName(chatId) }}</p>
        <p class="tp-mono text-xs text-dimmed break-all">{{ chatId.slice(0, 16) }}…</p>
        <UBadge v-if="friend?.verified" color="success" size="xs" icon="i-lucide-badge-check">{{ t('friends.verified') }}</UBadge>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <UButton :label="t('friends.rename')" icon="i-lucide-pencil" variant="soft" block @click="renameOpen = true" />
      <UButton :label="t('friends.copyCode')" icon="i-lucide-copy" variant="soft" block @click="copyCode" />
      <UButton :label="t('friends.verify')" icon="i-lucide-scan-eye" variant="soft" block @click="verifyOpen = true" />
      <UButton :label="friend?.pinned ? t('friends.unpin') : t('friends.pin')" :icon="friend?.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" variant="soft" block @click="togglePin" />
      <UButton :label="t('friends.archive')" icon="i-lucide-archive" variant="soft" block @click="toggleArchive" />
      <UDropdownMenu
        :items="[
          muted
            ? [{ label: t('friends.unmute'), icon: 'i-lucide-bell', onSelect: () => mute(0) }]
            : [
                { label: t('friends.mute8h'), onSelect: () => mute(8) },
                { label: t('friends.mute1w'), onSelect: () => mute(168) },
                { label: t('friends.muteAlways'), onSelect: () => mute(24 * 365 * 10) },
              ],
        ]"
      >
        <UButton :label="muted ? t('friends.unmute') : t('friends.mute')" :icon="muted ? 'i-lucide-bell' : 'i-lucide-bell-off'" variant="soft" block />
      </UDropdownMenu>
    </div>

    <div class="flex flex-col gap-1 pt-2 border-t border-(--tp-border)">
      <p class="tp-mono text-xs text-dimmed mb-1">{{ t('chats.localOnly') }}</p>
      <UButton :label="t('settings.backup.exportChat')" icon="i-lucide-file-text" variant="ghost" block class="justify-start" @click="emit('export-text')" />
      <UButton :label="t('settings.backup.exportChatJson')" icon="i-lucide-file-json" variant="ghost" block class="justify-start" @click="emit('export-json')" />
      <UButton :label="t('chats.clearHistory')" icon="i-lucide-eraser" variant="ghost" block class="justify-start text-warning" @click="emit('clear-history')" />
      <UButton :label="t('chats.deleteChat')" icon="i-lucide-trash-2" variant="ghost" block class="justify-start text-error" @click="emit('delete-chat')" />
      <UButton v-if="!contacts.blockedPks.has(chatId)" :label="t('friends.unfriend')" icon="i-lucide-user-x" variant="ghost" block class="justify-start text-error" @click="unfriend" />
      <UButton v-if="!contacts.blockedPks.has(chatId)" :label="t('friends.block')" icon="i-lucide-ban" variant="ghost" block class="justify-start text-error" @click="block" />
      <UButton v-else :label="t('chats.unblock')" icon="i-lucide-shield-check" variant="ghost" block class="justify-start" @click="unblock" />
    </div>

    <UModal v-model:open="verifyOpen" :title="t('friends.verify')">
      <template #body>
        <p class="text-xs text-dimmed mb-3">{{ t('friends.verifyHint') }}</p>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <div v-for="(g, i) in fp?.groups ?? []" :key="i" class="tp-panel p-2 text-center tp-mono text-lg">{{ g }}</div>
        </div>
        <UButton :label="t('friends.markVerified')" color="primary" block @click="setVerified" />
      </template>
    </UModal>

    <UModal v-model:open="renameOpen" :title="t('friends.rename')">
      <template #body>
        <UInput v-model="nickname" :placeholder="t('friends.nickname')" class="w-full" @keydown.enter="rename" />
      </template>
      <template #footer>
        <UButton :label="t('common.save')" color="primary" block @click="rename" />
      </template>
    </UModal>
  </div>
</template>

