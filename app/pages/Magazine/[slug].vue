<script setup lang="ts">
import { parseAdBlock } from "~~/core/Magazine/directives";
import { resolveMediaUrl } from "~~/core/Magazine/media";
import { pageTitle } from "~~/core/page-title";

/**
 * Magazine article page (layout inspired by news sites, themed by Telepatty):
 * title → metadata (category / date / reading time / author) → cover → body.
 * Plus: reading progress bar, share (Web Share API with copy fallback), back to
 * list, related by category, prev/next, wide-screen sidebar (5 newest + the ad
 * slot from the body's #ad block) and per-article SEO head.
 *
 * Honest limitation: with ssr:false the page is client-rendered — crawlers that
 * execute JS see the content, but social scrapers do not. See content/README.md.
 */
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const fmt = useFormat();
const settings = useSettingsStore();
const toast = useToast();
const baseURL = useRuntimeConfig().app.baseURL || "/";

const rz = useMagazine();

const slug = computed(() => String(route.params.slug ?? ""));
const article = computed(() => rz.findArticle(slug.value));
const category = computed(() =>
  article.value?.categoryId
    ? rz.categories.value.find((c) => c.id === article.value!.categoryId)
    : undefined,
);
const categoryName = computed(() =>
  category.value
    ? settings.language === "fa"
      ? category.value.nameFa
      : category.value.nameEn
    : article.value
      ? t("Magazine.uncategorized")
      : "",
);
const chipStyle = computed(() =>
  category.value?.color
    ? { color: category.value.color, borderColor: `${category.value.color}55` }
    : undefined,
);
const nav = computed(() => rz.neighbours(slug.value));
const relatedList = computed(() =>
  rz.related(slug.value, article.value?.categoryId ?? null),
);

/** first #ad block of the body → sidebar ad slot on wide screens */
const sidebarAd = computed(() => {
  const b = article.value?.blocks.find((x) => x.name === "ad");
  if (!b) return null;
  const ad = parseAdBlock(b.lines);
  return {
    url: ad.url,
    image: ad.image ? resolveMediaUrl(ad.image, baseURL) : null,
    label: ad.label,
    alt: ad.alt,
  };
});

/* --------------------------- reading progress --------------------------- */
const progress = ref(0);
let rafId = 0;
function onScroll(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const el = document.scrollingElement ?? document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    progress.value = max > 0 ? Math.min(1, el.scrollTop / max) : 1;
  });
}
onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  cancelAnimationFrame(rafId);
});

/* --------------------------------- share --------------------------------- */
const origin = typeof window !== "undefined" ? window.location.origin : "";
const shareUrl = computed(() => `${origin}${baseURL}Magazine/${slug.value}`);
async function share(): Promise<void> {
  if (!article.value) return;
  const payload = {
    title: article.value.title,
    text: article.value.description || article.value.title,
    url: shareUrl.value,
  };
  if (typeof navigator.share === "function") {
    await navigator.share(payload).catch(() => {});
    return;
  }
  await navigator.clipboard?.writeText(shareUrl.value).catch(() => {});
  toast.add({ title: t("Magazine.copied"), color: "neutral" });
}

/* --------------------------------- head ---------------------------------- */
const absoluteCover = computed(() =>
  article.value?.cover && origin
    ? `${origin}${article.value.cover}`
    : undefined,
);
/* the tab while the raw chunk is still loading: the magazine title («مجله —
   Telepatty»), i.e. the same head the list page and the build-time SEO tag ship */
useHead(() => {
  const a = article.value;
  if (!a) return { title: pageTitle(t("Magazine.title"), t("app.name")) };
  return {
    title: a.title,
    meta: [
      { name: "description", content: a.description || a.title },
      { property: "og:title", content: a.title },
      { property: "og:description", content: a.description || a.title },
      { property: "og:type", content: "article" },
      { property: "og:url", content: shareUrl.value },
      ...(absoluteCover.value
        ? [{ property: "og:image", content: absoluteCover.value }]
        : []),
      {
        name: "twitter:card",
        content: absoluteCover.value ? "summary_large_image" : "summary",
      },
      { name: "twitter:title", content: a.title },
      { name: "twitter:description", content: a.description || a.title },
      ...(absoluteCover.value
        ? [{ name: "twitter:image", content: absoluteCover.value }]
        : []),
    ],
    link: [{ rel: "canonical", href: shareUrl.value }],
  };
});

/* unknown slug once loaded → back to the list */
watch(rz.loading, (isLoading) => {
  if (!isLoading && !article.value) void router.replace("/Magazine");
});
</script>

<template>
  <div class="flex-1 overflow-y-auto overscroll-contain relative">
    <!-- reading progress -->
    <div class="sticky top-0 z-20 h-0.5">
      <div
        class="h-full bg-(--tp-accent)"
        :style="{ width: `${Math.round(progress * 100)}%` }"
      />
    </div>

    <div class="max-w-6xl w-full mx-auto p-3">
      <div
        v-if="rz.loading.value"
        class="flex flex-col gap-3 max-w-3xl mx-auto"
      >
        <div class="tp-panel aspect-[16/9] animate-pulse" />
        <div class="tp-panel h-8 animate-pulse" />
        <div class="tp-panel h-40 animate-pulse" />
      </div>

      <div v-else-if="article" class="flex gap-6 items-start">
        <article class="flex-1 min-w-0 max-w-3xl flex flex-col gap-4">
          <!-- back -->
          <NuxtLink
            to="/Magazine"
            class="tp-mono text-xs text-dimmed hover:text-(--tp-accent) inline-flex items-center gap-1 w-fit"
          >
            <UIcon name="i-lucide-arrow-left" class="rtl:rotate-180" />
            {{ t("Magazine.backToList") }}
          </NuxtLink>

          <!-- title first, then metadata -->
          <h1 class="text-2xl font-bold leading-tight">{{ article.title }}</h1>

          <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 tp-mono text-[11px] text-dimmed"
          >
            <span
              v-if="article.categoryId"
              class="px-1.5 py-0.5 rounded border"
              :style="chipStyle"
              >{{ categoryName }}</span
            >
            <span>{{ fmt.day(article.date) }}</span>
            <span>{{
              fmt.digits(t("Magazine.minutes", { n: article.readingMinutes }))
            }}</span>
            <span v-if="article.author">{{
              t("Magazine.byAuthor", { name: article.author })
            }}</span>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-share-2"
              :label="t('Magazine.share')"
              class="ms-auto"
              @click="share"
            />
          </div>

          <!-- cover -->
          <div
            v-if="article.cover"
            class="relative aspect-[16/9] rounded-(--ui-radius) overflow-hidden bg-(--tp-panel) border border-(--tp-border)"
          >
            <img
              :src="article.cover"
              :alt="article.title"
              class="absolute inset-0 size-full object-cover"
              decoding="async"
            />
          </div>

          <!-- body blocks -->
          <RzBlocks :blocks="article.blocks" />

          <!-- tags -->
          <div v-if="article.tags.length" class="flex flex-wrap gap-1.5 pt-1">
            <UBadge
              v-for="tag in article.tags"
              :key="tag"
              color="neutral"
              variant="subtle"
              size="sm"
              class="tp-mono"
            >
              <UIcon name="i-lucide-tag" class="me-1" />{{ tag }}
            </UBadge>
          </div>

          <!-- related by category -->
          <section
            v-if="relatedList.length"
            class="flex flex-col gap-2 pt-4 border-t border-(--tp-border)"
          >
            <h2
              class="tp-mono text-[11px] uppercase tracking-widest text-dimmed"
            >
              {{ t("Magazine.related") }}
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <RzArticleCard
                v-for="a in relatedList"
                :key="a.slug"
                :article="a"
                :category="
                  rz.categories.value.find((c) => c.id === a.categoryId)
                "
              />
            </div>
          </section>

          <!-- prev / next -->
          <nav class="flex gap-2 pt-4 border-t border-(--tp-border)">
            <NuxtLink
              v-if="nav.prev"
              :to="`/Magazine/${nav.prev.slug}`"
              class="tp-panel p-2 flex-1 min-w-0 flex flex-col hover:border-(--tp-accent)/60 transition-colors"
            >
              <span
                class="tp-mono text-[10px] text-dimmed inline-flex items-center gap-1"
                ><UIcon name="i-lucide-arrow-left" class="rtl:rotate-180" />{{
                  t("Magazine.prev")
                }}</span
              >
              <span class="text-xs font-medium truncate">{{
                nav.prev.title
              }}</span>
            </NuxtLink>
            <NuxtLink
              v-if="nav.next"
              :to="`/Magazine/${nav.next.slug}`"
              class="tp-panel p-2 flex-1 min-w-0 flex flex-col items-end text-end hover:border-(--tp-accent)/60 transition-colors"
            >
              <span
                class="tp-mono text-[10px] text-dimmed inline-flex items-center gap-1"
                >{{ t("Magazine.next")
                }}<UIcon name="i-lucide-arrow-right" class="rtl:rotate-180"
              /></span>
              <span class="text-xs font-medium truncate">{{
                nav.next.title
              }}</span>
            </NuxtLink>
          </nav>
        </article>

        <!-- wide screens only: 5 newest + ad slot (from the body's #ad block) -->
        <aside
          class="hidden xl:flex w-64 shrink-0 flex-col gap-3 sticky top-16"
        >
          <h2 class="tp-mono text-[11px] uppercase tracking-widest text-dimmed">
            {{ t("Magazine.newest") }}
          </h2>
          <NuxtLink
            v-for="a in rz.newest.value"
            :key="a.slug"
            :to="`/Magazine/${a.slug}`"
            class="tp-panel p-2 flex gap-2 items-center hover:border-(--tp-accent)/60 transition-colors"
            :class="a.slug === article.slug ? 'border-(--tp-accent)/60' : ''"
          >
            <div
              class="size-12 rounded overflow-hidden bg-(--tp-panel) border border-(--tp-border) shrink-0"
            >
              <img
                v-if="a.cover"
                :src="a.cover"
                :alt="a.title"
                class="size-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div class="min-w-0">
              <p class="text-xs font-medium leading-snug line-clamp-2">
                {{ a.title }}
              </p>
              <p class="tp-mono text-[10px] text-dimmed">
                {{ fmt.day(a.date) }}
              </p>
            </div>
          </NuxtLink>

          <div
            v-if="sidebarAd"
            class="tp-panel p-3 flex flex-col gap-2 border-dashed"
          >
            <p
              class="tp-mono text-[10px] uppercase tracking-widest text-dimmed"
            >
              {{ t("Magazine.adLabel") }}
            </p>
            <a
              :href="sidebarAd.url"
              target="_blank"
              rel="sponsored noopener"
              class="block min-w-0"
            >
              <img
                v-if="sidebarAd.image"
                :src="sidebarAd.image"
                :alt="sidebarAd.alt || t('Magazine.adLabel')"
                class="w-full rounded-(--ui-radius) object-cover"
                loading="lazy"
                decoding="async"
              />
              <span v-else class="text-sm underline decoration-dotted">{{
                sidebarAd.label || sidebarAd.url
              }}</span>
            </a>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
