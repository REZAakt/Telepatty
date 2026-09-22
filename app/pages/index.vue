<script setup lang="ts">
import ChatContextMenu from '../components/ChatContextMenu.vue'
import { MAX_PINNED_CHATS } from '~~/core/conversations'

const chats = useChatsStore()
const contacts = useContactsStore()
const { t } = useI18n()
const fmt = useFormat()
const toast = useToast()
const q = ref('')

/** Attachment previews show a localized label instead of (usually empty) text. */
const kindLabel = (kind?: 'image' | 'video' | 'file'): string =>
  kind === 'image' ? t('msg.photo') : kind === 'video' ? t('msg.video') : kind === 'file' ? t('msg.fileLabel') : ''

const chatLoaded = computed(() => q.value.length >= 0 && chats.loaded)

/**
 * Chat list renders ONLY what the conversations table already carries — the list
 * never touches the messages table (read `list` getter), so it stays O(chats) no
 * matter how many thousands of messages a thread holds.
 */
const rows = computed(() => {
  if (!chatLoaded.value) return []
  return chats.visible
    .filter((r) => !q.value || contacts.displayName(r.id).toLowerCase().includes(q.value.toLowerCase()))
    .map((r) => {
      const friend = contacts.friend(r.id)
      return {
        id: r.id,
        name: contacts.displayName(r.id),
        friend,
        preview: r.lastKind ? kindLabel(r.lastKind) : r.preview,
        time: r.activityAt ? fmt.time(r.activityAt) : '',
        unread: r.unread,
        typing: (chats.typing[r.id] ?? 0) > Date.now(),
        blocked: contacts.blockedPks.has(r.id),
        muted: r.muted,
        verified: friend?.verified === true,
        lastStatus: r.lastStatus,
        lastDirection: r.lastDirection,
      }
    })
})

/* --------------------- context menu: secondary click / long-press --------------------- */
const menu = ref<{ x: number; y: number; chatId: string; pinned: boolean } | null>(null)

const openMenuAt = (chatId: string, pinned: boolean, x: number, y: number): void => {
  menu.value = { x, y, chatId, pinned }
}

/** desktop: the `contextmenu` event (secondary click) opens Pin/Unpin */
const onContextMenu = (e: MouseEvent, chatId: string, pinned: boolean): void => {
  e.preventDefault()
  openMenuAt(chatId, pinned, e.clientX, e.clientY)
}

/** mobile: LONG-PRESS (≥500 ms, without dragging) opens the same menu */
const LONG_PRESS_MS = 500
let pressTimer: ReturnType<typeof setTimeout> | null = null
let pressStart: { x: number; y: number } | null = null

const onPressStart = (e: PointerEvent, chatId: string, pinned: boolean): void => {
  if (e.pointerType === 'mouse') return // desktop uses the contextmenu event
  pressStart = { x: e.clientX, y: e.clientY }
  pressTimer = setTimeout(() => {
    if (pressStart) openMenuAt(chatId, pinned, pressStart.x, pressStart.y)
    pressTimer = null
  }, LONG_PRESS_MS)
}
const onPressMove = (e: PointerEvent): void => {
  // a real drag cancels the long-press (scrolling, swipe)
  if (!pressTimer || !pressStart) return
  if (Math.abs(e.clientX - pressStart.x) > 10 || Math.abs(e.clientY - pressStart.y) > 10) cancelPress()
}
const cancelPress = (): void => {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = null
  pressStart = null
}
const onPressEnd = (): void => cancelPress()

/** a long-press must NOT also navigate — swallow the click right after the menu */
const onClickCapture = (e: MouseEvent): void => {
  if (!menu.value) return
  // clicks INSIDE the context menu belong to the menu itself
  if ((e.target as HTMLElement | null)?.closest?.('[role="menu"]')) return
  // any other click just closes the menu instead of navigating
  e.preventDefault()
  e.stopPropagation()
  menu.value = null
}

const onPinAction = async (pin: boolean): Promise<void> => {
  const target = menu.value
  if (!target) return
  const ok = await contacts.togglePin(target.chatId)
  if (ok) {
    toast.add({
      title: t(pin ? 'friends.pin' : 'friends.unpin'),
      description: contacts.displayName(target.chatId),
      color: 'neutral',
    })
  } else {
    toast.add({ title: t('chats.pinLimit', { n: MAX_PINNED_CHATS }), color: 'warning' })
  }
}


const { list: virtualRows, containerProps, wrapperProps } = useVirtualList(rows, {
  itemHeight: 76,
  overscan: 8,
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2" @click.capture="onClickCapture">
    <UInput v-model="q" :placeholder="t('chats.search')" icon="i-lucide-search" v-autofocus-desktop />

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

    <div v-if="rows.length > 50" v-bind="containerProps" class="flex-1 min-h-0 overflow-y-auto" @click.capture="onClickCapture">
      <div v-bind="wrapperProps" class="flex flex-col gap-2">
        <NuxtLink
          v-for="{ data: r } in virtualRows"
          :key="r.id"
          :to="`/chat/${r.id}`"
          class="tp-panel p-3 flex items-center gap-3 hover:border-(--tp-accent)/50 transition-colors min-h-[68px]"
          @contextmenu="onContextMenu($event, r.id, !!r.friend?.pinned)"
          @pointerdown="onPressStart($event, r.id, !!r.friend?.pinned)"
          @pointermove="onPressMove"
          @pointerup="onPressEnd"
          @pointercancel="onPressEnd"
        >
          <Avatar :pk="r.id" :name="r.name" :size="44" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1">
              <span class="font-semibold truncate">{{ r.name }}</span>
              <UIcon v-if="r.friend?.pinned" name="i-lucide-pin" class="size-3.5 opacity-60" />
              <UIcon v-if="r.muted" name="i-lucide-bell-off" class="size-3.5 opacity-60" />
              <UIcon v-if="r.verified" name="i-lucide-badge-check" class="size-3.5 text-(--tp-accent)" />
              <span v-if="r.time" class="ms-auto tp-mono text-xs text-dimmed shrink-0">{{ r.time }}</span>
            </div>
            <div class="flex items-center gap-1 text-sm">
              <span v-if="r.typing" class="text-(--tp-accent) tp-mono">{{ t('chats.typing') }}</span>
              <span v-else-if="r.blocked" class="tp-mono text-error text-xs">{{ t('chats.blocked') }}</span>
              <span v-else class="truncate text-dimmed">{{ r.preview }}</span>
              <UBadge v-if="r.unread" color="primary" size="xs" class="ms-auto shrink-0">{{ r.unread }}</UBadge>
            </div>
          </div>
          <StatusTicks v-if="r.lastStatus" :msg="{ state: r.lastStatus, direction: r.lastDirection ?? 'out' }" class="ms-1" />
        </NuxtLink>
      </div>
    </div>

    <template v-else>
      <NuxtLink
        v-for="r in rows"
        :key="r.id"
        :to="`/chat/${r.id}`"
        class="tp-panel p-3 flex items-center gap-3 hover:border-(--tp-accent)/50 transition-colors"
        @contextmenu="onContextMenu($event, r.id, !!r.friend?.pinned)"
        @pointerdown="onPressStart($event, r.id, !!r.friend?.pinned)"
        @pointermove="onPressMove"
        @pointerup="onPressEnd"
        @pointercancel="onPressEnd"
      >
        <Avatar :pk="r.id" :name="r.name" :size="44" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1">
            <span class="font-semibold truncate">{{ r.name }}</span>
            <UIcon v-if="r.friend?.pinned" name="i-lucide-pin" class="size-3.5 opacity-60" />
            <UIcon v-if="r.muted" name="i-lucide-bell-off" class="size-3.5 opacity-60" />
            <UIcon v-if="r.verified" name="i-lucide-badge-check" class="size-3.5 text-(--tp-accent)" />
            <span v-if="r.time" class="ms-auto tp-mono text-xs text-dimmed shrink-0">{{ r.time }}</span>
          </div>
          <div class="flex items-center gap-1 text-sm">
            <span v-if="r.typing" class="text-(--tp-accent) tp-mono">{{ t('chats.typing') }}</span>
            <span v-else-if="r.blocked" class="tp-mono text-error text-xs">{{ t('chats.blocked') }}</span>
            <span v-else class="truncate text-dimmed">{{ r.preview }}</span>
            <UBadge v-if="r.unread" color="primary" size="xs" class="ms-auto shrink-0">{{ r.unread }}</UBadge>
          </div>
        </div>
        <StatusTicks v-if="r.lastStatus" :msg="{ state: r.lastStatus, direction: r.lastDirection ?? 'out' }" class="ms-1" />
      </NuxtLink>
    </template>

    <!-- Pin/Unpin context menu (secondary click on desktop, long-press on mobile) -->
    <ChatContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :pinned="menu.pinned"
      :chat-name="contacts.displayName(menu.chatId)"
      @pin="onPinAction(true)"
      @unpin="onPinAction(false)"
      @close="menu = null"
    />
  </div>
</template>

