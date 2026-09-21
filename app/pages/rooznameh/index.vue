<script setup lang="ts">
import type { RzCategory } from '~~/core/rooznameh/articles'

/**
 * Rooznameh home: category chips (filter), search (title/description/tags),
 * responsive card grid, empty/no-result states, and a wide-screen side column
 * with the 5 newest articles (hidden on mobile).
 */
const { t } = useI18n()
const { loading, categories, articles, newest } = useRooznameh()
const settings = useSettingsStore()
const fmt = useFormat()

const activeCategory = ref<string>('')
const query = ref('')

const categoryOf = (id: string | null) => (id ? categories.value.find((c) => c.id === id) : undefined)
const nameOf = (c: RzCategory | undefined) => (c ? (settings.language === 'fa' ? c.nameFa : c.nameEn) : t('rooznameh.uncategorized'))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return articles.value.filter((a) => {
    if (activeCategory.value && a.categoryId !== activeCategory.value) return false
    if (!q) return true
    const cat = categoryOf(a.categoryId)
    const haystack = [a.title, a.description, ...a.tags, cat ? nameOf(cat) : ''].join(' ').toLowerCase()
    return haystack.includes(q)
  })
})

const hasQuery = computed(() => activeCategory.value !== '' || query.value.trim() !== '')

useHead(() => ({
  title: t('rooznameh.title'),
  meta: [{ name: 'description', content: t('rooznameh.tagline') }],
}))
</script>

<template>
  <div class="flex-1 overflow-y-auto overscroll-contain">
    <div class="max-w-6xl w-full mx-auto p-3 flex flex-col gap-4">
      <!-- header -->
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-newspaper" class="text-(--tp-accent) text-2xl" />
        <div class="min-w-0">
          <h1 class="text-lg font-bold">{{ t('rooznameh.title') }}</h1>
          <p class="text-xs text-dimmed truncate">{{ t('rooznameh.tagline') }}</p>
        </div>
      </div>

      <!-- search -->
      <UInput
        v-model="query"
        :placeholder="t('rooznameh.search')"
        icon="i-lucide-search"
        class="w-full"
        size="sm"
      />

      <!-- category chips -->
      <div class="flex flex-wrap gap-1.5">
        <UButton
          size="xs"
          :variant="activeCategory === '' ? 'soft' : 'ghost'"
          :color="activeCategory === '' ? 'primary' : 'neutral'"
          :label="t('rooznameh.all')"
          @click="activeCategory = ''"
        />
        <UButton
          v-for="c in categories"
          :key="c.id"
          size="xs"
          :variant="activeCategory === c.id ? 'soft' : 'ghost'"
          :color="activeCategory === c.id ? 'primary' : 'neutral'"
          :label="settings.language === 'fa' ? c.nameFa : c.nameEn"
          @click="activeCategory = activeCategory === c.id ? '' : c.id"
        />
      </div>

      <!-- loading -->
      <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div v-for="i in 3" :key="i" class="tp-panel aspect-[16/9] animate-pulse" />
      </div>

      <!-- empty / no results -->
      <div v-else-if="!articles.length" class="text-center py-16 flex flex-col items-center gap-2">
        <UIcon name="i-lucide-newspaper" class="text-4xl text-dimmed" />
        <p class="text-sm font-medium">{{ t('rooznameh.empty') }}</p>
        <p class="text-xs text-dimmed">{{ t('rooznameh.emptyHint') }}</p>
      </div>
      <div v-else-if="!filtered.length" class="text-center py-16 flex flex-col items-center gap-2">
        <UIcon name="i-lucide-search" class="text-4xl text-dimmed" />
        <p class="text-sm font-medium">{{ t('rooznameh.noResults') }}</p>
      </div>

      <!-- grid + newest sidebar -->
      <div v-else class="flex gap-6 items-start">
        <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <RzArticleCard
            v-for="a in filtered"
            :key="a.slug"
            :article="a"
            :category="categoryOf(a.categoryId)"
          />
        </div>

        <!-- wide screens only -->
        <aside class="hidden xl:flex w-64 shrink-0 flex-col gap-3 sticky top-16">
          <h2 class="tp-mono text-[11px] uppercase tracking-widest text-dimmed">{{ t('rooznameh.newest') }}</h2>
          <NuxtLink
            v-for="a in newest"
            :key="a.slug"
            :to="`/rooznameh/${a.slug}`"
            class="tp-panel p-2 flex gap-2 items-center hover:border-(--tp-accent)/60 transition-colors"
          >
            <div class="size-12 rounded overflow-hidden bg-(--tp-panel) border border-(--tp-border) shrink-0">
              <img v-if="a.cover" :src="a.cover" :alt="a.title" class="size-full object-cover" loading="lazy" decoding="async">
            </div>
            <div class="min-w-0">
              <p class="text-xs font-medium leading-snug line-clamp-2">{{ a.title }}</p>
              <p class="tp-mono text-[10px] text-dimmed">{{ fmt.day(a.date) }}</p>
            </div>
          </NuxtLink>
        </aside>
      </div>
    </div>
  </div>
</template>
