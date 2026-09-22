<script setup lang="ts">
import type { ChatMessageRow } from '~~/core/db'
import { BUBBLE_LAYOUT_DIR, bubbleSideClasses } from '~~/core/rtl'
import { SwipeTracker, vibrateReply } from '~~/core/swipe-reply'
import { formatBytes, looksLikeImage } from '~~/core/files'
import { getDb } from '~~/core/db'
import { useFileUrl } from '../composables/useFileUrl'

const props = defineProps<{
  msg: ChatMessageRow
  name?: string
  reply?: ChatMessageRow | null
  /** live transfer state for file messages (from the bus) */
  transfer?: { progress: number; state: 'waiting' | 'transferring' | 'failed' }
}>()
const emit = defineEmits<{
  (e: 'reply'): void
  (e: 'copy'): void
  (e: 'delete'): void
  (e: 'retry'): void
  (e: 'jump'): void
  (e: 'open-image', src: string): void
  (e: 'download'): void
  (e: 'cancel-file'): void
}>()

const settings = useSettingsStore()
const { t } = useI18n()
const fmt = useFormat()

const mine = computed(() => props.msg.direction === 'out')
/** ONE place defines the physical side of bubbles (Telegram-like, both directions). */
const side = computed(() => bubbleSideClasses(mine.value))

const kind = computed(() => props.msg.kind ?? 'text')
const fileMeta = computed(() => props.msg.fileMeta)
const file = useFileUrl(() => props.msg.fileId)
/** an "image" is only rendered as one after a content-sniff of the blob */
const verifiedImage = ref(false)
watch(
  () => props.msg.fileId,
  async (id) => {
    verifiedImage.value = false
    if (!id) return
    try {
      const row = await getDb().files.get(id)
      if (!row) return
      const head = new Uint8Array(await row.blob.slice(0, 16).arrayBuffer())
      verifiedImage.value = looksLikeImage(head, row.mime)
    } catch {
      verifiedImage.value = false
    }
  },
  { immediate: true },
)
const isRenderableImage = computed(() => kind.value === 'image' && !!file.url.value && verifiedImage.value)

const replyName = computed(() => {
  if (!props.reply) return t('msg.reply')
  return props.reply.direction === 'out' ? t('chats.you') : props.name
})
const replyExcerpt = computed(() => props.msg.replyExcerpt || props.reply?.body || t('msg.replyUnavailable'))

const attachmentKindLabel = computed(() =>
  kind.value === 'image' ? t('msg.photo') : kind.value === 'video' ? t('msg.video') : t('msg.fileLabel'),
)

const items = computed(() => [
  [
    { icon: 'i-lucide-reply', label: t('msg.reply'), onSelect: () => emit('reply') },
    { icon: 'i-lucide-copy', label: t('msg.copyText'), onSelect: () => emit('copy') },
    { icon: 'i-lucide-trash-2', label: t('msg.deleteForMe'), onSelect: () => emit('delete') },
  ],
])

/* ------------------------- swipe-left-to-reply ------------------------- */
const track = new SwipeTracker()
const swipeState = ref<{ active: boolean; dx: number; progress: number }>({ active: false, dx: 0, progress: 0 })
let pointerId: number | null = null

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return
  pointerId = e.pointerId
  track.reset()
  track.onDown(e.clientX, e.clientY)
}
function onPointerMove(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return
  const s = track.onMove(e.clientX, e.clientY)
  if (s.phase === 'vertical') {
    swipeState.value = { active: false, dx: 0, progress: 0 }
    return
  }
  if (s.phase === 'horizontal' || s.phase === 'triggered') {
    swipeState.value = { active: true, dx: s.dx, progress: s.progress }
  }
}
function onPointerUp(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return
  pointerId = null
  const fired = track.onUp()
  if (fired) {
    vibrateReply()
    emit('reply')
  }
  swipeState.value = { active: false, dx: 0, progress: 0 } // spring back
}
function onPointerCancel(): void {
  pointerId = null
  track.reset()
  swipeState.value = { active: false, dx: 0, progress: 0 }
}

/* ---------------------------- long-press menu --------------------------- */
const menuOpen = ref(false)
let pressTimer: ReturnType<typeof setTimeout> | null = null
function onMenuPointerDown(): void {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    menuOpen.value = true
    vibrateReply(8)
  }, 450)
}
function onMenuPointerUp(): void {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = null
}

const bubbleStyle = computed(() => {
  // pan-y keeps native vertical scroll (and the iOS edge-swipe) alive; we only
  // observe horizontal movement for the reply gesture
  const base: Record<string, string> = { touchAction: 'pan-y' }
  if (swipeState.value.active) base.transform = `translateX(${swipeState.value.dx}px)`
  return base
})
const swipeOpacity = computed(() => (swipeState.value.active ? Math.min(1, swipeState.value.progress * 2) : 0))
const replyIconSide = computed(() => (mine.value ? 'pe-3 order-first' : 'ps-3'))
</script>


<template>
  <!-- physically locked subtree (see BUBBLE_LAYOUT_DIR): own bubble on the
       right, peer's on the left — identically in en and fa. The root carries a
       definite width (w-full max-w-85%) so bubbleSideClasses()' physical auto
       margin really resolves; the rows then pack on the physical axis. -->
  <div class="group flex flex-col w-full max-w-[85%]" :class="side" :dir="BUBBLE_LAYOUT_DIR">
    <div class="flex items-center" :class="mine ? 'flex-row-reverse' : ''">
      <!-- reply icon that follows the swipe (Telegram-style) -->
      <UIcon
        name="i-lucide-reply"
        class="size-4 text-(--tp-accent) transition-opacity shrink-0"
        :class="replyIconSide"
        :style="{ opacity: swipeOpacity }"
        aria-hidden="true"
      />
      <div
        class="max-w-full px-3 py-1.5 relative tp-bubble rounded-(--ui-radius)"
        :class="[
          settings.appearance.bubbleStyle === 'classic' ? 'tp-panel' : '',
          mine ? 'tp-bubble-mine border-(--tp-accent)/40 rounded-se-sm' : 'tp-bubble-theirs rounded-ss-sm',
          swipeState.active ? '' : 'transition-transform duration-150',
        ]"
        :style="bubbleStyle"
        dir="auto"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <p v-if="!mine && name" class="tp-mono text-[10px] text-(--tp-accent) mb-0.5">{{ name }}</p>

        <!-- quoted block: tap to scroll to the original -->
        <button
          v-if="msg.replyTo"
          type="button"
          class="tp-bubble-reply mb-1.5 border-s-2 border-(--tp-accent) ps-2 pe-2 py-1 rounded-sm bg-(--tp-accent)/8 text-xs text-start w-full"
          :title="t('msg.jumpToReply')"
          @click.stop="emit('jump')"
        >
          <p class="tp-mono text-[10px] text-(--tp-accent) truncate">{{ replyName }}</p>
          <p class="truncate text-dimmed">{{ replyExcerpt }}</p>
        </button>

        <!-- IMAGE: blob URL only, sniffed before rendering; SVG/HTML → file card -->
        <img
          v-if="isRenderableImage"
          :src="file.url.value ?? undefined"
          :alt="fileMeta?.name ?? t('msg.photo')"
          class="rounded-md max-h-64 w-auto cursor-zoom-in"
          loading="lazy"
          @click.stop="file.url.value && emit('open-image', file.url.value)"
        >
        <!-- VIDEO: controls, never autoplay with sound -->
        <video
          v-else-if="kind === 'video' && file.url.value"
          :src="file.url.value"
          class="rounded-md max-h-64 w-auto"
          controls
          preload="metadata"
          playsinline
        />

        <!-- VOICE/AUDIO: inline player (voice notes arrive as audio/* files) -->
        <audio
          v-else-if="file.mime.value.startsWith('audio/') && file.url.value"
          :src="file.url.value"
          class="h-9 max-w-full"
          controls
          preload="metadata"
        />

        <!-- transfer progress / waiting / failed state for file messages -->
        <div v-if="kind !== 'text'" class="mt-1 flex flex-col gap-1">
          <div v-if="transfer && transfer.state === 'transferring'" class="h-1 rounded-full bg-(--tp-border) overflow-hidden">
            <div class="h-full bg-(--tp-accent) transition-all" :style="{ width: `${Math.round(transfer.progress * 100)}%` }" />
          </div>
          <div class="flex items-center gap-2 justify-end">
            <span v-if="transfer?.state === 'waiting'" class="tp-mono text-[10px] text-dimmed">{{ t('files.waitingDirect') }}</span>
            <span v-else-if="transfer?.state === 'failed'" class="tp-mono text-[10px] text-error">{{ t('files.failed') }}</span>
            <UButton
              v-if="transfer?.state === 'failed' && mine"
              size="xs"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :aria-label="t('common.retry')"
              @click.stop="emit('retry')"
            />
            <UButton
              v-if="transfer?.state === 'transferring' && mine"
              size="xs"
              variant="ghost"
              icon="i-lucide-x"
              :aria-label="t('common.cancel')"
              @click.stop="emit('cancel-file')"
            />
            <UButton
              v-if="!mine && !file.url.value && (!transfer || transfer.state === 'failed')"
              size="xs"
              variant="soft"
              icon="i-lucide-download"
              :label="t('common.download')"
              @click.stop="emit('download')"
            />
          </div>
        </div>

        <p v-if="msg.body && kind === 'text'" class="whitespace-pre-wrap break-words text-(--tp-font-size)">{{ msg.body }}</p>
        <p v-else-if="msg.body" class="whitespace-pre-wrap break-words text-(--tp-font-size) mt-1">{{ msg.body }}</p>
        <div class="flex items-center gap-1 justify-end mt-0.5">
          <span v-if="msg.expireAt" class="tp-mono text-[10px] text-dimmed" :title="t('msg.expireApplied')">
            <UIcon name="i-lucide-timer" class="size-3" />
          </span>
          <span class="tp-mono text-[10px] text-dimmed">{{ fmt.time(msg.ts) }}</span>
          <StatusTicks v-if="mine" :msg="msg" />
        </div>
        <div v-if="msg.state === 'failed' && kind === 'text'" class="flex justify-end mt-1">
          <UButton size="xs" color="error" variant="soft" :label="t('common.retry')" icon="i-lucide-refresh-cw" @click="$emit('retry')" />
        </div>
      </div>
    </div>
    <!-- hover controls (desktop); long-press opens the same menu on touch -->
    <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1" :class="mine ? 'flex-row-reverse' : ''">
      <UButton size="xs" variant="ghost" icon="i-lucide-reply" :aria-label="t('msg.reply')" @click="$emit('reply')" />
      <UDropdownMenu v-model:open="menuOpen" :items="items">
        <UButton size="xs" variant="ghost" icon="i-lucide-more-horizontal" :aria-label="t('common.menu')" @pointerdown="onMenuPointerDown" @pointerup="onMenuPointerUp" @pointerleave="onMenuPointerUp" />
      </UDropdownMenu>
    </div>
  </div>
</template>

