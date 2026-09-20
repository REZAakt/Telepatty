<script setup lang="ts">
const chats = useChatsStore()
const contacts = useContactsStore()
const { t } = useI18n()
const fmt = useFormat()
const q = ref('')

const rows = computed(() =>
  chats.visibleChatIds
    .filter((id) => !q.value || contacts.displayName(id).toLowerCase().includes(q.value.toLowerCase()))
    .map((id) => {
      const convo = chats.convos[id]
      return {
        id,
        name: contacts.displayName(id),
        friend: contacts.friend(id),
        preview: convo?.last?.body ?? '',
        time: convo?.last ? fmt.time(convo.last.ts) : '',
        unread: convo?.unread ?? 0,
        typing: (convo?.typingUntil ?? 0) > Date.now(),
        blocked: contacts.blockedPks.has(id),
      }
    }),
)

</script>

<template>
  <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
    <UInput v-model="q" :placeholder="t('chats.search')" icon="i-lucide-search" />

    <UAlert
      v-if="contacts.incomingRequests.length"
      color="primary"
      variant="soft"
      icon="i-lucide-user-plus"
      :title="t('friends.requests')"
      :description="t('friends.requestsCount', { n: contacts.incomingRequests.length })"
    >
      <template #actions>
        <UButton :to="'/friends?tab=requests'" :label="t('friends.review')" size="sm" variant="soft" />
      </template>

    </UAlert>

    <div v-if="!rows.length" class="flex-1 flex flex-col items-center justify-center gap-2 text-center opacity-70 py-16">
      <UIcon name="i-lucide-message-square-off" class="text-4xl" />
      <p class="font-semibold">{{ t('chats.empty') }}</p>
      <p class="text-sm text-dimmed max-w-xs">{{ t('chats.emptyHint') }}</p>
      <UButton to="/friends" color="primary" :label="t('friends.addFriend')" size="sm" class="mt-2" />
    </div>

    <NuxtLink v-for="r in rows" :key="r.id" :to="`/chat/${r.id}`" class="tp-panel p-3 flex items-center gap-3 hover:border-(--tp-accent)/50 transition-colors">
      <Avatar :pk="r.id" :name="r.name" :size="44" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1">
          <span class="font-semibold truncate">{{ r.name }}</span>
          <UIcon v-if="r.friend?.pinned" name="i-lucide-pin" class="size-3.5 opacity-60" />
          <UIcon v-if="r.friend?.mutedUntil && r.friend.mutedUntil > Date.now()" name="i-lucide-bell-off" class="size-3.5 opacity-60" />
          <UIcon v-if="r.friend?.verified" name="i-lucide-badge-check" class="size-3.5 text-(--tp-accent)" />
          <span v-if="r.time" class="ms-auto tp-mono text-xs text-dimmed shrink-0">{{ r.time }}</span>
        </div>
        <div class="flex items-center gap-1 text-sm">
          <span v-if="r.typing" class="text-(--tp-accent) tp-mono">{{ t('chats.typing') }}</span>
          <span v-else-if="r.blocked" class="tp-mono text-error text-xs">{{ t('chats.blocked') }}</span>
          <span v-else class="truncate text-dimmed">{{ r.preview }}</span>
          <UBadge v-if="r.unread" color="primary" size="xs" class="ms-auto shrink-0">{{ r.unread }}</UBadge>
        </div>
      </div>
    </NuxtLink>
  </div>
</template>
