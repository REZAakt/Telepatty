<script setup lang="ts">
/**
 * QR scanner: camera via getUserMedia (feature-detected — NOT BarcodeDetector,
 * which Safari/iOS does not implement) + decoding via the native
 * BarcodeDetector when the browser has one, otherwise a lazily-imported jsQR
 * WASM-free decoder. Camera is requested only while open and stopped on close.
 *
 * Error taxonomy is explicit: insecure context, permission denied, no camera,
 * and only when there is genuinely no camera/mediaDevices do we fall back to
 * "paste the code".
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'scanned', text: string): void }>()

const openLocal = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
})

const { t } = useI18n()
const video = ref<HTMLVideoElement | null>(null)
const error = ref('')
const scanning = ref(false)
let stream: MediaStream | null = null
let raf = 0
/** lazily imported jsQR decoder (Safari/iOS has no BarcodeDetector) */
let jsqr: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null

const close = () => emit('update:open', false)

type MediaError = { name?: string }
type BarcodeDetectorLike = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/** Decode one video frame: BarcodeDetector if present, else jsQR on a canvas. */
async function detectFrame(detector: BarcodeDetectorLike | null, v: HTMLVideoElement): Promise<string | null> {
  if (detector) {
    try {
      const codes = await detector.detect(v)
      return codes[0]?.rawValue ?? null
    } catch {
      return null
    }
  }
  if (!jsqr) {
    const mod = (await import('jsqr')) as { default: NonNullable<typeof jsqr> }
    jsqr = mod.default
  }
  const w = v.videoWidth
  const h = v.videoHeight
  if (!w || !h) return null
  // sample at a moderate size: big enough for QRs, small enough to stay smooth
  const scale = Math.min(1, 480 / w)
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  canvas ??= document.createElement('canvas')
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw
    canvas.height = ch
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) return null
  ctx.drawImage(v, 0, 0, cw, ch)
  const image = ctx.getImageData(0, 0, cw, ch)
  return jsqr(image.data, cw, ch)?.data ?? null
}

const start = async () => {
  error.value = ''
  // 1) secure context (getUserMedia is https/localhost only)
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    error.value = t('errors.cameraInsecure')
    return
  }
  // 2) getUserMedia support — feature-detect THIS, never BarcodeDetector
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = t('errors.cameraUnsupported')
    return
  }
  // 3) camera
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
  } catch (e) {
    const name = (e as MediaError)?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      error.value = t('errors.cameraDenied')
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'TrackStartError') {
      error.value = t('errors.cameraMissing')
    } else {
      error.value = t('errors.cameraDenied')
    }
    return
  }
  const v = video.value
  if (v) {
    v.srcObject = stream
    try {
      // muted + playsinline + loaded metadata keep iOS Safari happy
      await v.play()
    } catch {
      /* autoplay refusal — frames may still flow once metadata loads */
    }
  }
  scanning.value = true

  // BarcodeDetector is optional — Chrome/Android has it, Safari/iOS does not
  const w = window as unknown as { BarcodeDetector?: new (o?: unknown) => BarcodeDetectorLike }
  const detector = w.BarcodeDetector ? new w.BarcodeDetector() : null

  let lastTick = 0
  const tick = async (now: number) => {
    if (!scanning.value) return
    // throttle to ~15 fps
    if (now - lastTick < 66) {
      raf = requestAnimationFrame(tick)
      return
    }
    lastTick = now
    const el = video.value
    if (el && el.readyState >= 2) {
      try {
        const text = await detectFrame(detector, el)
        if (text) {
          emit('scanned', text)
          close()
          return
        }
      } catch {
        /* frame skip */
      }
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

const stop = () => {
  scanning.value = false
  cancelAnimationFrame(raf)
  stream?.getTracks().forEach((tr) => tr.stop())
  stream = null
  const v = video.value
  if (v) v.srcObject = null
}

watch(
  () => props.open,
  (open) => {
    if (open) void start()
    else stop()
  },
)

onUnmounted(stop)
</script>

<template>
  <UModal v-model:open="openLocal" :title="t('friends.scanQr')">
    <template #body>
      <div class="flex flex-col gap-3">
        <video
          v-show="scanning"
          ref="video"
          class="w-full rounded-(--ui-radius) bg-black aspect-square object-cover"
          muted
          playsinline
          autoplay
        />
        <p v-if="scanning" class="text-center text-xs text-dimmed">{{ t('friends.scanningHint') }}</p>
        <UAlert v-if="error" color="error" variant="soft" :description="error" />
        <UButton :label="t('common.close')" variant="soft" @click="close" />
      </div>
    </template>
  </UModal>
</template>

