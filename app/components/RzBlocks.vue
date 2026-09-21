<script setup lang="ts">
import { renderMarkdown } from '~~/core/rooznameh/render'
import {
  parseAdBlock,
  parseCalloutLines,
  parseMediaLine,
  parseQuoteLines,
  parseSourceLine,
  mediaKind,
  type MediaItem,
  type RzBlock,
} from '~~/core/rooznameh/directives'
import { resolveMediaUrl } from '~~/core/rooznameh/media'

/**
 * Renders Rooznameh block directives: #text / #media / #ad / #quote /
 * #callout / #source. Markdown is sanitized in core/rooznameh/render.ts;
 * media is restricted to local /media paths (resolved through baseURL so
 * GitHub Pages sub-paths keep working). Missing files degrade to a visible
 * placeholder instead of a broken <img>.
 */
const props = defineProps<{ blocks: RzBlock[] }>()
const { t } = useI18n()
const baseURL = useRuntimeConfig().app.baseURL || '/'

const lightboxSrc = ref<string | null>(null)
const lightboxAlt = ref('')

function html(lines: string[]): string {
  return renderMarkdown(lines.join('\n'), baseURL)
}

function mediaItems(lines: string[]): MediaItem[] {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const { name, caption } = parseMediaLine(l)
      return { name, caption, src: resolveMediaUrl(name, baseURL), kind: mediaKind(name) }
    })
}

function adOf(lines: string[]) {
  const ad = parseAdBlock(lines)
  return { ...ad, image: ad.image ? resolveMediaUrl(ad.image, baseURL) : null }
}

function quoteOf(lines: string[]) {
  return parseQuoteLines(lines)
}

function calloutOf(lines: string[]) {
  return parseCalloutLines(lines)
}

function sourceOf(lines: string[]) {
  return parseSourceLine(lines.join(' '))
}

const cols = (n: number): string => (n >= 2 ? 'grid grid-cols-1 sm:grid-cols-2' : 'grid')

const isPlainText = (name: string): boolean => !['media', 'ad', 'quote', 'callout', 'source'].includes(name)

const onOpen = (src: string, alt: string): void => {
  lightboxSrc.value = src
  lightboxAlt.value = alt
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <template v-for="(b, i) in props.blocks" :key="i">
      <!-- #text (default markdown; unknown directives degrade to text too) -->
      <div v-if="isPlainText(b.name)" class="rz-prose" v-html="html(b.lines)" />

      <!-- #media: responsive gallery, reserved aspect ratio, lazy, lightbox -->
      <div v-else-if="b.name === 'media'" :class="cols(mediaItems(b.lines).length)" class="gap-3">
        <figure v-for="(m, mi) in mediaItems(b.lines)" :key="mi" class="flex flex-col gap-1 min-w-0">
          <template v-if="m.src">
            <button
              v-if="m.kind === 'image'"
              type="button"
              class="relative aspect-[3/2] w-full overflow-hidden rounded-(--ui-radius) bg-(--tp-panel) border border-(--tp-border) cursor-zoom-in"
              :aria-label="m.caption || m.name"
              @click="onOpen(m.src!, m.caption || m.name)"
            >
              <img :src="m.src" :alt="m.caption || m.name" class="absolute inset-0 size-full object-cover" loading="lazy" decoding="async">
            </button>
            <video
              v-else
              :src="m.src"
              class="w-full aspect-video rounded-(--ui-radius) bg-black border border-(--tp-border)"
              controls
              preload="metadata"
              playsinline
            />
          </template>
          <div v-else class="aspect-[3/2] w-full rounded-(--ui-radius) bg-(--tp-panel) border border-dashed border-(--tp-border) flex flex-col items-center justify-center gap-1 text-dimmed">
            <UIcon name="i-lucide-image-off" class="text-2xl" />
            <span class="tp-mono text-[10px]">{{ t('rooznameh.missingMedia', { name: m.name }) }}</span>
          </div>
          <figcaption v-if="m.caption" class="text-[11px] text-dimmed text-center">{{ m.caption }}</figcaption>
        </figure>
      </div>

      <!-- #ad: labeled promo, image + link (or text), always rel=sponsored noopener -->
      <aside v-else-if="b.name === 'ad'" class="tp-panel p-3 flex flex-col gap-2 border-dashed">
        <p class="tp-mono text-[10px] uppercase tracking-widest text-dimmed">{{ t('rooznameh.adLabel') }}</p>
        <a :href="adOf(b.lines).url" target="_blank" rel="sponsored noopener" class="block min-w-0">
          <img
            v-if="adOf(b.lines).image"
            :src="adOf(b.lines).image || undefined"
            :alt="adOf(b.lines).alt || t('rooznameh.adLabel')"
            class="w-full rounded-(--ui-radius) max-h-64 object-cover"
            loading="lazy"
            decoding="async"
          >
          <span v-else class="text-sm underline decoration-dotted">{{ adOf(b.lines).label || adOf(b.lines).url }}</span>
          <span v-if="adOf(b.lines).image && adOf(b.lines).label" class="block mt-1 text-xs text-dimmed">{{ adOf(b.lines).label }}</span>
        </a>
      </aside>

      <!-- #quote: markdown quote with optional source -->
      <blockquote v-else-if="b.name === 'quote'" class="border-s-2 border-(--tp-accent) ps-4 py-1">
        <div class="rz-prose italic" v-html="html([quoteOf(b.lines).md])" />
        <footer v-if="quoteOf(b.lines).source" class="tp-mono text-[11px] text-dimmed mt-1">— {{ quoteOf(b.lines).source }}</footer>
      </blockquote>

      <!-- #callout: info / warning note -->
      <div
        v-else-if="b.name === 'callout'"
        class="rounded-(--ui-radius) p-3 flex gap-2 items-start border"
        :class="calloutOf(b.lines).variant === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-primary/40 bg-primary/10'"
      >
        <UIcon
          :name="calloutOf(b.lines).variant === 'warning' ? 'i-lucide-triangle-alert' : 'i-lucide-info'"
          class="text-lg shrink-0 mt-0.5"
          :class="calloutOf(b.lines).variant === 'warning' ? 'text-warning' : 'text-primary'"
        />
        <div class="rz-prose min-w-0" v-html="html([calloutOf(b.lines).md])" />
      </div>

      <!-- #source: credit line under an image/section -->
      <p v-else-if="b.name === 'source'" class="tp-mono text-[10px] text-dimmed">
        <template v-if="sourceOf(b.lines).url">
          {{ t('rooznameh.source') }}:
          <a :href="sourceOf(b.lines).url" target="_blank" rel="noopener noreferrer" class="underline decoration-dotted">{{ sourceOf(b.lines).text }}</a>
        </template>
        <template v-else>{{ t('rooznameh.source') }}: {{ sourceOf(b.lines).text }}</template>
      </p>
    </template>

    <Lightbox v-if="lightboxSrc" :src="lightboxSrc" :alt="lightboxAlt" @close="lightboxSrc = null" />
  </div>
</template>
