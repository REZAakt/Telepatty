<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Full-screen image lightbox for the magazine.
 *
 * Why the old close button "did not work": the close control was a Nuxt UI
 * `<UButton>` captured through a component ref, and `onMounted` called
 * `closeBtn.value?.focus()` on that COMPONENT INSTANCE (not an element) —
 * `focus` is not a function there, so mount threw, focus management died, and
 * the button itself depended on attr fall-through for its click. It is now a
 * plain native `<button>` (element ref, real focus, no fall-through) on its
 * own z-layer.
 *
 * Interaction contract:
 * - close: button, Esc, backdrop click, swipe down (threshold + velocity),
 *   and the browser/mobile Back button (a history entry is pushed on open and
 *   popped on close — Back never leaves the article).
 * - navigate: ←/→ arrows and horizontal swipe between the images of the
 *   article.
 * - a11y: role="dialog" + aria-modal, focus moves to the close button on open
 *   and is restored on close, Tab is trapped inside the dialog.
 * - body scroll is locked while open and restored afterwards; videos behind
 *   the lightbox pause on close; every listener is removed on unmount.
 */
export interface LightboxImage {
  src: string
  alt?: string
}

const { t } = useI18n()
const props = defineProps<{ items: LightboxImage[]; index: number }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'update:index', index: number): void }>()

const SWIPE_PX = 110
const SWIPE_VELOCITY = 0.55 // px/ms

const root = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)

const current = computed(() => props.items[props.index] ?? props.items[0])
const hasMultiple = computed(() => props.items.length > 1)

const nav = (dir: -1 | 1): void => {
  if (!hasMultiple.value) return
  const next = (props.index + dir + props.items.length) % props.items.length
  emit('update:index', next)
}

/* ------------------------------ close paths ------------------------------ */
let pushedHistory = false
let closingViaHistory = false

function doClose(): void {
  // pause any video playing in the article behind the lightbox
  document.querySelectorAll('video').forEach((v) => {
    try {
      v.pause()
    } catch {
      /* ignore */
    }
  })
  emit('close')
}

function requestClose(): void {
  if (closingViaHistory) return
  // close NOW (the parent unmounts us), then silently pop our history entry —
  // closingViaHistory keeps the popstate handler quiet for our own back()
  doClose()
  if (pushedHistory) {
    closingViaHistory = true
    history.back()
  }
}

function onPopState(): void {
  // the USER pressed Back while the lightbox is open → close, consume the entry
  if (closingViaHistory) return
  closingViaHistory = true
  doClose()
}

/* -------------------------------- keyboard -------------------------------- */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    requestClose()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    nav(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    nav(1)
  } else if (e.key === 'Tab') {
    // keep focus inside the dialog
    const focusables = root.value?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
    if (!focusables || focusables.length === 0) {
      e.preventDefault()
      closeBtn.value?.focus()
      return
    }
    const list = Array.from(focusables)
    const first = list[0]!
    const last = list[list.length - 1]!
    const active = document.activeElement
    const inside = active instanceof Node && root.value?.contains(active)
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }
}
/* --------------------- swipe: down = close, x = navigate ------------------- */
const dragX = ref(0)
const dragY = ref(0)
const dragging = ref(false)
let startX = 0
let startY = 0
let startTime = 0
let axis: 'x' | 'y' | null = null

const dragStyle = computed(() => {
  if (!dragging.value) return { transition: 'transform 160ms ease, opacity 160ms ease' }
  const progress = Math.min(1, Math.abs(dragY.value) / 320)
  return {
    transform: `translate(${dragX.value}px, ${dragY.value}px) scale(${1 - progress * 0.08})`,
    opacity: `${1 - progress * 0.5}`,
    transition: 'none',
  }
})

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  startX = e.clientX
  startY = e.clientY
  startTime = e.timeStamp
  axis = null
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent): void {
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!axis && Math.hypot(dx, dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
  if (axis === 'y') {
    dragging.value = true
    dragX.value = 0
    dragY.value = Math.max(0, dy) // downward only — it means "close"
  } else if (axis === 'x' && hasMultiple.value) {
    dragging.value = true
    dragY.value = 0
    dragX.value = dx
  }
}

function onPointerUp(e: PointerEvent): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  const dt = Math.max(1, e.timeStamp - startTime)
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  const fastY = Math.abs(dy) / dt > SWIPE_VELOCITY && Math.abs(dy) > 40
  const fastX = Math.abs(dx) / dt > SWIPE_VELOCITY && Math.abs(dx) > 40
  if (axis === 'y' && (dy > SWIPE_PX || fastY)) requestClose()
  else if (axis === 'x' && hasMultiple.value && (Math.abs(dx) > SWIPE_PX || fastX)) nav(dx < 0 ? 1 : -1)
  dragging.value = false
  dragX.value = 0
  dragY.value = 0
  axis = null
}

/* ------------------------- scroll lock + lifecycle ------------------------ */
let prevHtmlOverflow = ''
let prevBodyOverflow = ''
let restoreFocusTo: HTMLElement | null = null

onMounted(() => {
  restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const html = document.documentElement
  const body = document.body
  prevHtmlOverflow = html.style.overflow
  prevBodyOverflow = body.style.overflow
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('popstate', onPopState)
  // a dedicated history entry: the mobile/browser Back button closes us
  history.pushState({ tpLightbox: true }, '')
  pushedHistory = true
  closeBtn.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('popstate', onPopState)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  document.documentElement.style.overflow = prevHtmlOverflow
  document.body.style.overflow = prevBodyOverflow
  // we are closing without the Back flow → drop our history entry if still on top
  if (pushedHistory && !closingViaHistory && (history.state as { tpLightbox?: boolean } | null)?.tpLightbox) {
    closingViaHistory = true
    history.back()
  }
  restoreFocusTo?.focus()
})
</script>


<template>
  <div
    ref="root"
    class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 select-none"
    role="dialog"
    aria-modal="true"
    :aria-label="current?.alt ?? 'image'"
    @click.self="requestClose()"
  >
    <!-- plain native buttons: element refs, real focus, click never swallowed -->
    <button
      ref="closeBtn"
      type="button"
      class="absolute top-3 end-3 z-10 size-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 text-white flex items-center justify-center cursor-pointer"
      :aria-label="t('common.close')"
      @click.stop="requestClose()"
    >
      <UIcon name="i-lucide-x" class="text-lg" />
    </button>
    <button
      v-if="hasMultiple"
      type="button"
      class="absolute start-3 top-1/2 -translate-y-1/2 z-10 size-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 text-white flex items-center justify-center cursor-pointer"
      aria-label="previous image"
      @click.stop="nav(-1)"
    >
      <UIcon name="i-lucide-chevron-left" class="text-lg rtl:rotate-180" />
    </button>
    <button
      v-if="hasMultiple"
      type="button"
      class="absolute end-3 top-1/2 -translate-y-1/2 z-10 size-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 text-white flex items-center justify-center cursor-pointer"
      aria-label="next image"
      @click.stop="nav(1)"
    >
      <UIcon name="i-lucide-chevron-right" class="text-lg rtl:rotate-180" />
    </button>

    <!-- stage: owns pointer gestures (touch-action none), drags feed back live -->
    <div
      class="max-w-full flex items-center justify-center touch-none"
      :style="dragStyle"
      @pointerdown="onPointerDown"
    >
      <img
        :src="current?.src"
        :alt="current?.alt ?? ''"
        class="max-h-[calc(100dvh-2rem)] max-w-full object-contain rounded-md"
        draggable="false"
      >
    </div>
  </div>
</template>
