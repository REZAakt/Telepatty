<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Floating chat-list context menu: Pin / Unpin and Delete chat.
 * Opened with a RIGHT-CLICK on desktop (`contextmenu`) and a LONG-PRESS on
 * mobile (pointer events, 500 ms). Closes on any outside click/pointer, Esc,
 * scroll or when the action fires.
 */
const props = defineProps<{
  /** viewport coordinates where the menu should appear */
  x: number
  y: number
  pinned: boolean
  chatName: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pin'): void
  (e: 'unpin'): void
  (e: 'delete'): void
}>()

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)

/** keep the menu inside the viewport (incl. the iOS safe area) */
const pos = ref({ x: props.x, y: props.y })
function clamp(): void {
  const w = root.value?.offsetWidth ?? 160
  const h = root.value?.offsetHeight ?? 96
  pos.value = {
    x: Math.min(props.x, window.innerWidth - w - 8),
    y: Math.min(props.y, window.innerHeight - h - 8),
  }
}
onMounted(() => {
  clamp()
  window.addEventListener('resize', onOutside)
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('pointermove', onOutsideMove, true)
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onOutside)
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('pointermove', onOutsideMove, true)
  window.removeEventListener('keydown', onKey, true)
})

/** any pointer outside the menu closes it (capture: runs before row handlers) */
function onOutside(e: Event): void {
  if (root.value && !root.value.contains(e.target as Node)) emit('close')
}
/**
 * A long-press DRAG (finger moves >10px while STILL OUTSIDE the menu) closes
 * instead of navigating. BUGFIX (hover-close): this used to close on ANY move
 * — including the plain cursor glide OVER the open menu — because the menu
 * element itself was never checked. Moves that start inside the menu (or over
 * it) are ignored, so the menu stays open while the cursor hovers it.
 */
let sx = 0
let sy = 0
function onOutsideMove(e: PointerEvent): void {
  if (root.value?.contains(e.target as Node)) return
  if (sx === 0 && sy === 0) {
    sx = e.clientX
    sy = e.clientY
    return
  }
  if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) {
    sx = 0
    sy = 0
    emit('close')
  }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

function act(action: 'pin' | 'unpin' | 'delete'): void {
  if (action === 'pin') emit('pin')
  else if (action === 'unpin') emit('unpin')
  else emit('delete')
  emit('close')
}
</script>

<template>
  <div
    ref="root"
    role="menu"
    class="fixed z-[90] tp-panel p-1 min-w-40 shadow-xl"
    :style="{ top: `${pos.y}px`, left: `${pos.x}px` }"
  >
    <p class="tp-mono text-[10px] text-dimmed px-2 py-1 truncate">{{ chatName }}</p>
    <button
      v-if="!pinned"
      type="button"
      role="menuitem"
      class="w-full flex items-center gap-2 px-2 py-2 rounded-(--ui-radius) text-sm hover:bg-elevated/50 cursor-pointer text-start"
      @click.stop="act('pin')"
    >
      <UIcon name="i-lucide-pin" class="text-(--tp-accent) shrink-0" />
      {{ t('friends.pin') }}
    </button>
    <button
      v-else
      type="button"
      role="menuitem"
      class="w-full flex items-center gap-2 px-2 py-2 rounded-(--ui-radius) text-sm hover:bg-elevated/50 cursor-pointer text-start"
      @click.stop="act('unpin')"
    >
      <UIcon name="i-lucide-pin-off" class="text-dimmed shrink-0" />
      {{ t('friends.unpin') }}
    </button>

    <!--
      Delete chat: the only way to drop a thread whose contact is gone (blocked,
      unfriended or unblocked-but-not-re-added) — it lives here so it works from
      the chat list itself, without opening the chat first.
    -->
    <div class="my-1 border-t border-(--tp-border)" />
    <button
      type="button"
      role="menuitem"
      class="w-full flex items-center gap-2 px-2 py-2 rounded-(--ui-radius) text-sm text-error hover:bg-elevated/50 cursor-pointer text-start"
      @click.stop="act('delete')"
    >
      <UIcon name="i-lucide-trash-2" class="text-error shrink-0" />
      {{ t('chats.deleteChat') }}
    </button>
  </div>
</template>
