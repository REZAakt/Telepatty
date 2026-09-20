<script setup lang="ts">
import type { ChatMessageRow } from '~~/core/db'
import { getDb } from '~~/core/db'
import { DISAPPEARING_OPTIONS } from '~~/core/theme'

const route = useRoute()
const router = useRouter()
const chats = useChatsStore()
const contacts = useContactsStore()
const identity = useIdentityStore()
const ui = useUiStore()
const settings = useSettingsStore()
const { t } = useI18n()
const fmt = useFormat()
const toast = useToast()

const chatId = computed(() => String(route.params.id ?? ''))
const friend = computed(() => contacts.friend(chatId.value))
const msgs = computed(() => chats.sorted(chatId.value))
const convo = computed(() => chats.convos[chatId.value])
const typing = computed(() => (convo.value?.typingUntil ?? 0) > Date.now())
const replyTo = ref<ChatMessageRow | null>(null)
const input = ref('')
const contactOpen = ref(false)
const timerOpen = ref(false)
const busy = ref(false)

// message list scrolling: the pane scrolls, the composer stays pinned at the bottom
const listEl = ref<HTMLElement | null>(null)
const nearBottom = (): boolean => {
  const el = listEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 160
}
const scrollToBottom = (smooth = false): void => {
  const el = listEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

const grouped = computed(() => {
  const out: { day: string; items: ChatMessageRow[] }[] = []
  for (const m of msgs.value) {
    const day = fmt.day(m.ts)
    const last = out.at(-1)
    if (last?.day === day) last.items.push(m)
    else out.push({ day, items: [m] })
  }
  return out
})

onMounted(() => {
  if (!friend.value) {
    toast.add({ title: t('friends.invalidInvite'), color: 'error' })
    void router.replace('/')
    return
  }
  chats.markRead(chatId.value)
  ui.updateBadge()
  void getMessenger()?.webrtc?.initiate(chatId.value)
  nextTick(() => scrollToBottom())
})

watch(
  () => msgs.value.length,
  () => {
    chats.markRead(chatId.value)
    ui.updateBadge()
    // follow new messages only when the user is already near the bottom
    const stick = nearBottom()
    nextTick(() => {
      if (stick) scrollToBottom(true)
    })
  },
)

const send = async () => {
  const body = input.value.trim()
  if (!body || busy.value) return
  input.value = ''
  const reply = replyTo.value?.id
  replyTo.value = null
  busy.value = true
  try {
    await getMessenger()?.sendChat(chatId.value, body, reply)
  } catch (e) {
    toast.add({ title: t('errors.generic', { e: String(e) }), color: 'error' })
  } finally {
    busy.value = false
  }
}

const retry = async (m: ChatMessageRow) => {
  await getMessenger()?.outbox?.retryFailed(m.id)
  await getMessenger()?.outbox?.process()
}

const copy = async (m: ChatMessageRow) => {
  await navigator.clipboard?.writeText(m.body).catch(() => {})
  toast.add({ title: t('common.copied'), color: 'neutral' })
}

const onExpiry = async (seconds: number) => {
  await contacts.setDisappearing(chatId.value, seconds)
  timerOpen.value = false
}

const disappearLabel = computed(() => {
  const secs = friend.value?.expireAfter ?? settings.disappearDefault
  if (!secs) return t('chats.expireOff')
  const o = DISAPPEARING_OPTIONS.find((x) => x.value === secs)
  return o?.label ?? String(secs)
})

const exportChat = (json: boolean) => {
  const rows = msgs.value.map((m) => ({
    ts: new Date(m.ts).toISOString(),
    from: m.direction === 'out' ? 'me' : friend.value?.nickname || friend.value?.name || m.from,
    body: m.body,
  }))
  const text = json ? JSON.stringify(rows, null, 2) : rows.map((r) => `[${r.ts}] ${r.from}: ${r.body}`).join('\n')
  const blob = new Blob([text], { type: json ? 'application/json' : 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `telepatty-chat-${chatId.value.slice(0, 8)}.${json ? 'json' : 'txt'}`
  a.click()
  URL.revokeObjectURL(a.href)
}

const deleteChat = async () => {
  if (!confirm(t('chats.deleteChatConfirm'))) return
  await getDb().messages.where('chatId').equals(chatId.value).delete()
  chats.removeConvo(chatId.value)
  toast.add({ title: t('chats.localOnly'), color: 'neutral' })
  void router.replace('/')
}

const clearHistory = async () => {
  if (!confirm(t('chats.clearConfirm'))) return
  await chats.clearHistory(chatId.value)
}

const directConnected = computed(() => !!getMessenger()?.webrtc?.connected(chatId.value))
const transportLabel = computed(() =>
  directConnected.value ? t('chats.direct') : ui.transportStatus === 'connected' ? t('chats.relay') : t('chats.offlineTransport'),
)
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0">
    <div class="flex items-center gap-2 p-2 border-b border-(--tp-border)">
      <UButton icon="i-lucide-arrow-left" to="/" variant="ghost" size="sm" :aria-label="t('nav.back')" class="rtl:rotate-180" />
      <button class="flex items-center gap-2 min-w-0" @click="contactOpen = true">
        <Avatar :pk="chatId" :name="contacts.displayName(chatId)" :size="36" />
        <div class="min-w-0 text-start">
          <p class="font-semibold truncate text-sm">{{ contacts.displayName(chatId) }}</p>
          <p class="tp-mono text-xs text-dimmed">{{ typing ? t('chats.typing') : transportLabel }}</p>
        </div>
      </button>
      <UBadge v-if="disappearLabel !== t('chats.expireOff')" size="sm" variant="subtle" class="tp-mono">
        {{ disappearLabel }}
      </UBadge>
      <div class="flex-1" />
      <UButton icon="i-lucide-more-vertical" variant="ghost" size="sm" aria-label="menu" @click="contactOpen = true" />
    </div>

    <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 flex flex-col gap-1">
      <template v-for="g in grouped" :key="g.day">
        <div class="text-center my-2">
          <span class="tp-mono text-xs text-dimmed tp-panel px-2 py-1">{{ g.day }}</span>
        </div>
        <MessageBubble
          v-for="m in g.items"
          :key="m.id"
          :msg="m"
          :name="contacts.displayName(m.direction === 'out' ? identity.pk : m.from)"
          @reply="replyTo = m"
          @copy="copy(m)"
          @delete="chats.removeMessage(chatId, m.id)"
          @retry="retry(m)"
        />
      </template>
      <div v-if="typing" class="tp-mono text-xs text-(--tp-accent) ps-2">{{ t('chats.typing') }}</div>
    </div>

    <!-- composer: pinned to the bottom of the viewport, never scrolls away -->
    <div v-if="friend" class="shrink-0 p-2 border-t border-(--tp-border) flex flex-col gap-1">
      <div v-if="replyTo" class="flex items-center gap-2 text-xs tp-panel p-1.5">
        <UIcon name="i-lucide-reply" />
        <span class="truncate flex-1">{{ replyTo.body }}</span>
        <UButton icon="i-lucide-x" size="xs" variant="ghost" @click="replyTo = null" />

      </div>
      <div v-if="contacts.blockedPks.has(chatId)" class="text-center text-xs text-error tp-mono py-2">{{ t('chats.blockedNotice') }}</div>
      <form v-else class="flex items-end gap-2" @submit.prevent="send">
        <UTextarea v-model="input" :placeholder="t('msg.placeholder')" autoresize :rows="1" :maxrows="6" class="flex-1 min-w-0" :maxlength="8000" @keydown.enter.exact.prevent="send" />
        <UButton type="submit" icon="i-lucide-send" :disabled="!input.trim() || busy" :loading="busy" aria-label="send" />
      </form>
    </div>

    <USlideover v-model:open="contactOpen" :title="contacts.displayName(chatId)">
      <template #body>
        <ContactActions
          :chat-id="chatId"
          @close="contactOpen = false"
          @export-text="exportChat(false)"
          @export-json="exportChat(true)"
          @delete-chat="deleteChat"
          @clear-history="clearHistory"
        />
      </template>
    </USlideover>

    <UModal v-model:open="timerOpen" :title="t('settings.privacy.disappearing')">
      <template #body>
        <p class="text-xs text-dimmed mb-2">{{ t('settings.relays.hint') }}</p>
        <div class="flex flex-col gap-1">
          <UButton
            v-for="o in DISAPPEARING_OPTIONS"
            :key="o.value"
            :label="o.label === 'off' ? t('chats.expireOff') : o.label"
            :variant="Number(friend?.expireAfter ?? settings.disappearDefault) === o.value ? 'soft' : 'ghost'"
            :color="Number(friend?.expireAfter ?? settings.disappearDefault) === o.value ? 'primary' : 'neutral'"
            class="justify-start"
            @click="onExpiry(o.value)"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

