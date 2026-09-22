<script setup lang="ts">
/** QR code display (qrcode package, canvas-rendered). */
import QRCode from 'qrcode'

const props = defineProps<{ text: string; size?: number }>()
const el = ref<HTMLCanvasElement | null>(null)
const settings = useSettingsStore()

/**
 * Colors come from the LIVE theme tokens (useTheme writes `--tp-accent` /
 * `--tp-bg` on <html>) — never from a hardcoded matrix green, so the QR follows
 * the accent and surface the user picked, in both color modes.
 * The probe runs the value through the CSS parser, so the canvas always gets a
 * color it can consume (hex, rgb(...) or oklch(...)).
 */
function colorToken(name: string, fallback: string): string {
  if (!import.meta.client) return fallback
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || fallback
}

/** Repaint whenever the theme moves (primary/accent or color mode). */
const themeKey = computed(() =>
  [settings.appearance.primary, settings.appearance.accent ?? '', settings.appearance.colorMode].join('|'),
)

watchEffect(async () => {
  void themeKey.value // reactive dependency: a theme change must recolour the QR
  if (!el.value || !props.text) return
  try {
    await QRCode.toCanvas(el.value, props.text, {
      width: props.size ?? 220,
      margin: 1,
      color: { dark: colorToken('--tp-accent', '#00ff9d'), light: colorToken('--tp-bg', '#050807') },
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
