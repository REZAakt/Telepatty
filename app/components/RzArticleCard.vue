<script setup lang="ts">
import type { RzArticle, RzCategory } from "~~/core/Magazine/articles";

/**
 * Magazine article card: cover (fixed aspect, no layout shift), title,
 * category chip and a compact numeric date (locale/jalali/digits aware via
 * useFormat). Reading time deliberately lives on the article page only — the
 * list stays scannable.
 */
const props = defineProps<{ article: RzArticle; category?: RzCategory }>();
const fmt = useFormat();
const settings = useSettingsStore();

const chipStyle = computed(() =>
  props.category?.color
    ? { color: props.category.color, borderColor: `${props.category.color}55` }
    : undefined,
);
</script>

<template>
  <NuxtLink
    :to="`/Magazine/${article.slug}`"
    class="tp-panel overflow-hidden flex flex-col gap-2 hover:border-(--tp-accent)/60 transition-colors"
  >
    <div class="relative aspect-[16/9] bg-(--tp-panel)">
      <img
        v-if="article.cover"
        :src="article.cover"
        :alt="article.title"
        class="absolute inset-0 size-full object-cover"
        loading="lazy"
        decoding="async"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <UIcon name="i-lucide-newspaper" class="text-3xl text-dimmed" />
      </div>
    </div>
    <div class="px-3 pb-3 flex flex-col gap-1.5 min-w-0">
      <div class="flex items-center gap-2 text-[10px] tp-mono">
        <span
          v-if="category"
          class="px-1.5 py-0.5 rounded border"
          :style="chipStyle"
          >{{
            settings.language === "fa" ? category.nameFa : category.nameEn
          }}</span
        >
        <span class="text-dimmed">{{ fmt.date(article.date) }}</span>
      </div>
      <h3 class="font-bold text-sm leading-snug line-clamp-2">
        {{ article.title }}
      </h3>
      <p v-if="article.description" class="text-xs text-dimmed line-clamp-2">
        {{ article.description }}
      </p>
    </div>
  </NuxtLink>
</template>
