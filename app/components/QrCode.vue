<script setup lang="ts">
/** QR code display (qrcode package, canvas-rendered). */
import QRCode from 'qrcode'

const props = defineProps<{ text: string; size?: number }>()
const el = ref<HTMLCanvasElement | null>(null)

watchEffect(async () => {
  if (!el.value || !props.text) return
  try {
    await QRCode.toCanvas(el.value, props.text, {
      width: props.size ?? 220,
      margin: 1,
      color: { dark: '#00ff9d', light: '#050807' },
      errorCorrectionLevel: 'M',
    })
  } catch {
    /* invalid payload */
  }
})
</script>

<template>
  <canvas ref="el" class="rounded-(--ui-radius)" aria-label="QR code" />
</template>
