<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
 * - rotate: ±90° buttons AND a drag-rotate mode (mouse drag / touch drag
 *   rotates the image live); double-click/double-tap resets the view.
 * - zoom: pinch (touch) and mouse wheel; while zoomed in, a single drag pans
 *   instead of navigating.
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

/* ------------------- rotate + zoom + pan (requirement #8) ------------------ */
const ZOOM_MIN = 1
const ZOOM_MAX = 8
const ROTATE_STEP = 90
/** degrees of rotation per dragged pixel (drag-rotate mode) */
const ROTATE_DRAG_FACTOR = 0.5

const rotation = ref(0)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
/** when active, a drag rotates the image instead of swiping */
const rotateMode = ref(false)

let startPanX = 0
let startPanY = 0
let startRotation = 0

/** the image's own transform — rotation/zoom/pan live here (swipe feedback
 *  stays on the stage), eased only while no gesture is running */
const imgStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) rotate(${rotation.value}deg) scale(${zoom.value})`,
  transition: dragging.value ? 'none' : 'transform 180ms ease',
}))

function resetView(): void {
  rotation.value = 0
  zoom.value = ZOOM_MIN
  panX.value = 0
  panY.value = 0
}

function rotateBy(deg: number): void {
  rotation.value = (((rotation.value + deg) % 360) + 360) % 360
}

/** mouse wheel zoom (desktop) */
function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const factor = Math.exp(-e.deltaY * 0.0015)
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value * factor))
  if (zoom.value <= ZOOM_MIN + 0.001) {
    panX.value = 0
    panY.value = 0
  }
}

/** every active pointer (1 = swipe/pan/rotate, 2 = pinch zoom) */
const pointers = new Map<number, { x: number; y: number }>()
let pinchBaseDist = 1
let pinchBaseZoom = 1

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    // PINCH begins — cancel any single-pointer gesture
    dragging.value = false
    dragX.value = 0
    dragY.value = 0
    axis = null
    const pts = [...pointers.values()]
    pinchBaseDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) || 1
    pinchBaseZoom = zoom.value
    return
  }
  if (pointers.size > 2) return
  startX = e.clientX
  startY = e.clientY
  startTime = e.timeStamp
  axis = null
  startPanX = panX.value
  startPanY = panY.value
  startRotation = rotation.value
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent): void {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  // pinch zoom: distance between the two active pointers drives the scale
  if (pointers.size >= 2) {
    const pts = [...pointers.values()]
    const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) || 1
    zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchBaseZoom * (dist / pinchBaseDist)))
    return
  }
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  // drag-rotate mode: horizontal drag spins the image
  if (rotateMode.value) {
    dragging.value = true
    rotation.value = startRotation + dx * ROTATE_DRAG_FACTOR
    return
  }
  // zoomed in: a drag PANS the image (no navigation while zoomed)
  if (zoom.value > ZOOM_MIN + 0.001) {
    panX.value = startPanX + dx
    panY.value = startPanY + dy
    return
  }
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
  pointers.delete(e.pointerId)
  // a pinch that still has one finger down just continues as pan/rotate —
  // keep the window listeners until the LAST pointer is released
  if (pointers.size === 1) {
    // re-anchor the single-pointer gesture on the remaining finger
    const [p] = [...pointers.values()]
    startX = p!.x
    startY = p!.y
    startPanX = panX.value
    startPanY = panY.value
    startRotation = rotation.value
    axis = null
    return
  }
  if (pointers.size >= 1) return
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  // rotate/pan gestures end here — nothing to commit
  if (rotateMode.value || zoom.value > ZOOM_MIN + 0.001) {
    dragging.value = false
    axis = null
    return
  }
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

// a different image is shown → start from a clean view
watch(
  () => props.index,
  () => resetView(),
)

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
    <!-- rotate / zoom toolbar (top-start): ±90°, drag-rotate mode -->
    <div class="absolute top-3 start-3 z-10 flex items-center gap-1.5">
      <button
        type="button"
        class="size-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 text-white flex items-center justify-center cursor-pointer"
        :aria-label="t('lightbox.rotateLeft')"
        :title="t('lightbox.rotateLeft')"
        @click.stop="rotateBy(-ROTATE_STEP)"
      >
        <UIcon name="i-lucide-rotate-ccw" class="text-lg" />
      </button>
      <button
        type="button"
        class="size-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 text-white flex items-center justify-center cursor-pointer"
        :aria-label="t('lightbox.rotateRight')"
        :title="t('lightbox.rotateRight')"
        @click.stop="rotateBy(ROTATE_STEP)"
      >
        <UIcon name="i-lucide-rotate-cw" class="text-lg" />
      </button>
      <button
        type="button"
        class="size-10 rounded-full border flex items-center justify-center cursor-pointer"
        :class="rotateMode ? 'bg-(--tp-accent)/90 text-black border-(--tp-accent)' : 'bg-black/60 hover:bg-black/80 border-white/20 text-white'"
        :aria-label="t('lightbox.rotateDrag')"
        :aria-pressed="rotateMode"
        :title="t('lightbox.rotateDrag')"
        @click.stop="rotateMode = !rotateMode"
      >
        <UIcon name="i-lucide-grip-vertical" class="text-lg" />
      </button>
    </div>
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
