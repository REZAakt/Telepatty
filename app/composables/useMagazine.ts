/**
 * Magazine content loader.
 *
 * Content lives in `content/Magazine/*.md` at the project root (categories in
 * `_categories.md`, one file per article). Files are collected with a build-time
 * glob and each one is imported LAZILY (`query: '?raw'`, non-eager) — every
 * article becomes its own async chunk and nothing is pulled into the messenger
 * bundle: only the two magazine routes (which Nuxt code-splits anyway) request
 * this composable.
 *
 * Parsing/validation happens in `core/Magazine/*` (pure + unit-tested); this
 * composable only wires the glob, the shared cache and the console warnings.
 */
import {
  buildArticle,
  byNewest,
  normalizeCategories,
  type RzArticle,
  type RzCategory,
} from "~~/core/Magazine/articles";
import { splitFrontmatter } from "~~/core/Magazine/frontmatter";

/** build-time glob: relative to this file → <project>/content/Magazine/*.md */
const modules = import.meta.glob("../../content/Magazine/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export interface MagazineData {
  categories: RzCategory[];
  /** sorted newest-first, drafts excluded */
  articles: RzArticle[];
}

let cache: MagazineData | null = null;
let pending: Promise<MagazineData> | null = null;

function slugOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/, "");
}

async function load(baseURL: string): Promise<MagazineData> {
  // categories file first (underscore = not an article)
  const rawEntries = await Promise.all(
    Object.entries(modules).map(
      async ([path, loadRaw]) => [path, await loadRaw()] as const,
    ),
  );
  const categoriesSource = rawEntries.find(
    ([path]) => slugOf(path) === "_categories",
  );
  const categories = normalizeCategories(
    splitFrontmatter(categoriesSource?.[1] ?? "").data,
  );

  const articles: RzArticle[] = [];
  for (const [path, raw] of rawEntries) {
    const slug = slugOf(path);
    if (slug === "_categories" || slug.startsWith("_")) continue; // internal files
    const { article, warnings } = buildArticle(slug, raw, categories, baseURL);
    for (const w of warnings) console.warn(w);
    if (article) articles.push(article);
  }
  articles.sort(byNewest);
  return { categories, articles };
}

/** Shared loader: parses once per session, awaited by both magazine pages. */
export function useMagazine() {
  const data = ref<MagazineData | null>(cache);
  const loading = ref(!cache);

  onMounted(() => {
    if (cache) {
      data.value = cache;
      loading.value = false;
      return;
    }
    const baseURL = useRuntimeConfig().app.baseURL || "/";
    pending ??= load(baseURL).then((res) => {
      cache = res;
      return res;
    });
    void pending.then((res) => {
      data.value = res;
      loading.value = false;
    });
  });

  const categories = computed(() => data.value?.categories ?? []);
  const articles = computed(() => data.value?.articles ?? []);
  /** the 5 newest articles (sidebar on wide screens) */
  const newest = computed(() => articles.value.slice(0, 5));
  const findArticle = (slug: string): RzArticle | undefined =>
    articles.value.find((a) => a.slug === slug);
  /** neighbours by date for prev/next navigation */
  const neighbours = (slug: string): { prev?: RzArticle; next?: RzArticle } => {
    const i = articles.value.findIndex((a) => a.slug === slug);
    if (i < 0) return {};
    return { prev: articles.value[i + 1], next: articles.value[i - 1] };
  };
  const related = (slug: string, categoryId: string | null): RzArticle[] => {
    const same = articles.value.filter(
      (a) => a.slug !== slug && a.categoryId && a.categoryId === categoryId,
    );
    return same.slice(0, 3);
  };

  return {
    loading: readonly(loading),
    categories,
    articles,
    newest,
    findArticle,
    neighbours,
    related,
  };
}
