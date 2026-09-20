<script setup lang="ts">
/**
 * QR scanner using the native BarcodeDetector where available, with graceful
 * fallback. Camera is requested only while open and stopped on close.
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

const close = () => emit('update:open', false)

const start = async () => {
  error.value = ''
  const w = window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }
  if (!w.BarcodeDetector) {
    error.value = t('errors.cameraUnsupported')
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    if (video.value) {
      video.value.srcObject = stream
      await video.value.play()
    }
    scanning.value = true
    const detector = new w.BarcodeDetector()
    const tick = async () => {
      if (!scanning.value || !video.value) return
      try {
        const codes = await detector.detect(video.value)
        const first = codes[0]
        if (first) {
          emit('scanned', first.rawValue)
          close()
          return
        }

      } catch {
        /* frame skip */
      }
      raf = requestAnimationFrame(() => void tick())
    }
    void tick()
  } catch {
    error.value = t('errors.cameraDenied')
  }
}

const stop = () => {
  scanning.value = false
  cancelAnimationFrame(raf)
  stream?.getTracks().forEach((tr) => tr.stop())
  stream = null
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
        <video v-show="scanning" ref="video" class="w-full rounded-(--ui-radius) bg-black aspect-square object-cover" muted playsinline />
        <UAlert v-if="error" color="error" variant="soft" :description="error" />
        <UButton :label="t('common.close')" variant="soft" @click="close" />
      </div>
    </template>
  </UModal>
</template>

