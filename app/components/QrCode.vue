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
 *
 * ROOT CAUSE of the blank/never-drawn QR: the `qrcode` package paints with the
 * browser canvas, which accepts `oklch(...)`/`color-mix(...)` fine — but the
 * library itself VALIDATES the color strings first with its own regex/parse
 * (only hex / rgb / hsl / css color names). Tailwind 4 tokens resolve to
 * `oklch(...)`, `toCanvas` threw, and the old empty `catch` swallowed the
 * error silently → the canvas stayed empty forever.
 *
 * FIX: parse the computed token with a probe element, then convert whatever
 * comes back to plain `#rrggbb` hex (via a temporary canvas — the browser
 * normalizes ANY color the canvas itself understands) before handing it to the
 * library. High-contrast pair is guaranteed: accent on the page background.
 */
function tokenToHex(name: string, fallback: string): string {
  if (!import.meta.client) return fallback
  try {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    if (!resolved) return fallback
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const ctx = cv.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = resolved
    ctx.fillRect(0, 0, 1, 1)
    const px = ctx.getImageData(0, 0, 1, 1).data
    return `#${[0, 1, 2]
      .map((i) => (px[i] ?? 0).toString(16).padStart(2, '0'))
      .join('')}`
  } catch {
    return fallback
  }
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
      color: {
        dark: tokenToHex('--tp-accent', '#00ff9d'),
        light: tokenToHex('--tp-bg', '#050807'),
      },
      errorCorrectionLevel: 'M',
    })
  } catch (e) {
    // never silently blank: paint a last-resort guaranteed-valid black/white QR
    console.warn('[telepatty] QR paint failed, using fallback colors', e)
    try {
      await QRCode.toCanvas(el.value, props.text, {
        width: props.size ?? 220,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
    } catch {
      /* invalid payload */
    }
  }
})
</script>

<template>
  <canvas ref="el" class="rounded-(--ui-radius)" aria-label="QR code" />
</template>
