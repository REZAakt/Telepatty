import process from "node:process";
import { execSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NuxtConfig } from "nuxt/config";
import { PREFS_BOOT_SCRIPT } from "./core/prefs-inline";
import {
  articleBodyHtml,
  articleHeadHtml,
  injectIntoShell,
  listHeadHtml,
  resolveOgImage,
} from "./core/Magazine/seo";
import {
  buildArticle,
  byNewest,
  normalizeCategories,
  type RzArticle,
} from "./core/Magazine/articles";
import { splitFrontmatter } from "./core/Magazine/frontmatter";
import {
  articleRoutes,
  basePath,
  listArticles,
  sitemapUrls,
  type SitemapArticle,
} from "./core/Magazine/sitemap";

const baseURL = process.env.TELEPATTY_BASE_URL || "/";
/** Build-time flag: in `nuxt dev` the PWA SW/manifest are disabled, so the
 *  manifest <link> is omitted to avoid browser "Manifest: Syntax error" noise
 *  (the dev server has no webmanifest file to serve). */
const isProd = process.env.NODE_ENV === "production";

let appVersion = "0.0.0";
try {
  const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version: string };
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    /* no git (e.g. CI tarball) */
  }
  appVersion = sha ? `${pkg.version}+${sha}` : pkg.version;
} catch {
  /* keep fallback */
}

/* The ONE source of truth for the sitemap: `content/Magazine/*.md` plus the Nuxt page
 * files. `core/Magazine/sitemap.ts` (fs + pure helpers, unit-tested) turns that
 * folder into the `<url>` entries `@nuxtjs/sitemap` publishes — absolute URLs whose
 * `lastmod` is the article's OWN frontmatter date (`updated`/`updatedAt`/`date`),
 * never the build clock, with drafts and title-less files excluded — and into the
 * per-article prerender routes, so GitHub Pages answers 200 for every sitemap URL
 * instead of the SPA 404 fallback (a 404 is never indexed).
 * `public/sitemap.xml` is build OUTPUT, not a source file: the module writes it
 * during `nuxt generate` and nothing here (or in `public/`) edits it by hand.
 * Absolute URLs need an origin — set TELEPATTY_ORIGIN, which defaults to the
 * PUBLISHED domain (https://telepatty.ir; the old rezaakt.github.io fallback shipped
 * a sitemap pointing at the wrong host, so Google Search Console rejected every URL). */
const siteOrigin = (
  process.env.TELEPATTY_ORIGIN || "https://telepatty.ir"
).replace(/\/$/, "");

const MagazineContentDir = fileURLToPath(
  new URL("./content/Magazine", import.meta.url),
);

let MagazineArticles: SitemapArticle[] = [];
try {
  MagazineArticles = listArticles(MagazineContentDir);
} catch {
  /* no content dir yet — skip quietly */
}
const MagazineArticleRoutes = articleRoutes(MagazineArticles);

/* robots.txt stays ours (@nuxtjs/robots is not installed) and must advertise the
 * sitemap on the SAME origin the module builds its URLs from. */
writeFileSync(
  new URL("./public/robots.txt", import.meta.url),
  [
    "User-Agent: *",
    "Disallow:",
    "",
    "# regenerated at build time from TELEPATTY_ORIGIN (nuxt.config.ts) — paste this",
    "# in Google Search Console → Sitemaps",
    `Sitemap: ${siteOrigin}${basePath(baseURL)}/sitemap.xml`,
    "",
  ].join("\n"),
);

/* Generate-time SEO: the prerendered shells (ssr:false → bare app HTML) are
 * rewritten per article with real head tags + crawlable text — pure builders
 * in core/Magazine/seo.ts (unit-tested), fs + wiring here. Reuses the SAME
 * parse path as the app (buildArticle), so a content typo can't diverge. */
let MagazineSeoArticles: RzArticle[] | null = null;
function loadMagazineSeoArticles(): RzArticle[] {
  if (MagazineSeoArticles) return MagazineSeoArticles;
  const list: RzArticle[] = [];
  try {
    const dir = new URL("./content/Magazine", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    const raws = new Map<string, string>();
    for (const f of files) {
      raws.set(
        f.replace(/\.md$/, ""),
        readFileSync(
          new URL(`./content/Magazine/${f}`, import.meta.url),
          "utf8",
        ),
      );
    }
    const categories = normalizeCategories(
      splitFrontmatter(raws.get("_categories") ?? "").data,
    );
    for (const [slug, raw] of raws) {
      if (slug.startsWith("_")) continue;
      const { article, warnings } = buildArticle(
        slug,
        raw,
        categories,
        baseURL,
      );
      for (const w of warnings) console.warn(w);
      if (article) list.push(article);
    }
  } catch (e) {
    console.warn(
      "[Magazine] SEO article load failed — prerendered shells stay generic",
      e,
    );
  }
  MagazineSeoArticles = list.sort(byNewest);
  return MagazineSeoArticles;
}

/** Cover files live in public/ (copied verbatim into the build output). */
const MagazineCoverExists = (cover: string): boolean =>
  existsSync(join(fileURLToPath(new URL("./public", import.meta.url)), cover));

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  typescript: { strict: true, typeCheck: false },
  modules: [
    "@nuxt/ui",
    "@nuxtjs/i18n",
    "@pinia/nuxt",
    "@vite-pwa/nuxt",
    "@vueuse/nuxt",
    "@nuxtjs/sitemap",
  ],
  /* Icons are compiled into the client bundle from the locally installed
   * `@iconify-json/lucide` collection. Nothing is fetched from
   * api.iconify.design at runtime — the CSP forbids it and the PWA must work
   * fully offline. The list covers every icon used in app/ plus the Nuxt UI
   * component defaults. */
  icon: {
    provider: "none",
    fallbackToApi: false,
    clientBundle: {
      icons: [
        "lucide:alert-circle",
        "lucide:alert-octagon",
        "lucide:archive",
        "lucide:archive-restore",
        "lucide:arrow-down",
        "lucide:arrow-left",
        "lucide:arrow-right",
        "lucide:arrow-up",
        "lucide:arrow-up-right",
        "lucide:badge-check",
        "lucide:ban",
        "lucide:bell",
        "lucide:bell-off",
        "lucide:camera",
        "lucide:check",
        "lucide:check-check",
        "lucide:chevron-down",
        "lucide:chevron-left",
        "lucide:chevron-right",
        "lucide:chevrons-left",
        "lucide:chevrons-right",
        "lucide:chevron-up",
        "lucide:circle-alert",
        "lucide:circle-check",
        "lucide:circle-help",
        "lucide:circle-x",
        "lucide:clipboard",
        "lucide:clock",
        "lucide:copy",
        "lucide:copy-check",
        "lucide:database",
        "lucide:database-backup",
        "lucide:download",
        "lucide:ellipsis",
        "lucide:eraser",
        "lucide:eye",
        "lucide:eye-off",
        "lucide:file",
        "lucide:file-json",
        "lucide:file-text",
        "lucide:film",
        "lucide:folder",
        "lucide:folder-open",
        "lucide:grip-vertical",
        "lucide:hard-drive",
        "lucide:hash",
        "lucide:image",
        "lucide:image-off",
        "lucide:info",
        "lucide:key-round",
        "lucide:languages",
        "lucide:lightbulb",
        "lucide:link",
        "lucide:paperclip",
        "lucide:globe",
        "lucide:external-link",
        "lucide:mic",
        "lucide:mic-off",
        "lucide:unlink",
        "lucide:loader-circle",
        "lucide:lock",
        "lucide:lock-keyhole",
        "lucide:menu",
        "lucide:message-square",
        "lucide:message-square-off",
        "lucide:minus",
        "lucide:monitor",
        "lucide:moon",
        "lucide:more-horizontal",
        "lucide:more-vertical",
        "lucide:network",
        "lucide:newspaper",
        "lucide:palette",
        "lucide:panel-left-close",
        "lucide:panel-left-open",
        "lucide:pencil",
        "lucide:pin",
        "lucide:pin-off",
        "lucide:plus",
        "lucide:qr-code",
        "lucide:refresh-cw",
        "lucide:reply",
        "lucide:rotate-ccw",
        "lucide:rotate-cw",
        "lucide:scan-eye",
        "lucide:scroll-text",
        "lucide:search",
        "lucide:send",
        "lucide:server",
        "lucide:settings",
        "lucide:share-2",
        "lucide:shield",
        "lucide:shield-check",
        "lucide:shield-x",
        "lucide:square",
        "lucide:star",
        "lucide:sun",
        "lucide:timer",
        "lucide:trash-2",
        "lucide:triangle-alert",
        "lucide:upload",
        "lucide:user",
        "lucide:user-plus",
        "lucide:users",
        "lucide:user-x",
        "lucide:calendar",
        "lucide:tag",
        "lucide:wifi",
        "lucide:wifi-off",
        "lucide:x",
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  app: {
    baseURL,
    head: {
      title: "Telepatty",
      htmlAttrs: { lang: "en" },
      script: [
        // Pre-paint boot: settings are restored from the versioned localStorage
        // snapshot (`tp.prefs.v1`, see core/prefs.ts) synchronously, BEFORE the
        // first paint — lang, dir (RTL/LTR from the locale), theme class, font
        // size and accent color are applied with no flash, even while the
        // async IndexedDB read is still pending. Falls back to the 0.1.x
        // mirrors (tp.lang / tp.appearance). CSP allows 'unsafe-inline'.
        // The script lives in core/prefs-inline.ts and is kept in parity with
        // applyPrefsToDocument() by core/prefs.test.ts.
        { innerHTML: PREFS_BOOT_SCRIPT },
      ],
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        {
          name: "description",
          content: "Telepatty — serverless end-to-end encrypted messenger",
        },
        { name: "theme-color", content: "#050807" },
        {
          "http-equiv": "Content-Security-Policy",
          content: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
            "font-src 'self' data:",
            "connect-src 'self' wss: ws: blob:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
          ].join("; "),
        },
      ],
      link: [
        {
          rel: "icon",
          type: "image/png",
          href: `${baseURL}icons/icon-192.png`,
        },
        { rel: "apple-touch-icon", href: `${baseURL}icons/icon-192.png` },
        ...(isProd
          ? [
              {
                rel: "manifest" as const,
                href: `${baseURL}manifest.webmanifest`,
              },
            ]
          : []),
      ],
    },
  },
  runtimeConfig: {
    public: { appVersion },
  },
  vite: {
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
  },
  fonts: {
    families: [
      { name: "Vazirmatn", provider: "google", weights: [400, 500, 700] },
      { name: "JetBrains Mono", provider: "google", weights: [400, 600] },
    ],
  },
  i18n: {
    defaultLocale: "en",
    strategy: "no_prefix",
    locales: [
      { code: "en", language: "en-US", name: "English", file: "en.json" },
      // `dir` is what makes useLocaleHead()/the i18n runtime emit dir="rtl" for fa.
      {
        code: "fa",
        language: "fa-IR",
        name: "فارسی",
        file: "fa.json",
        dir: "rtl",
      },
    ],
    // DO NOT prefix this with `i18n/`. @nuxtjs/i18n resolves `vueI18n` with
    // cwd = <rootDir>/i18n (its `restructureDir`), so a bare filename points at
    // i18n/vue-i18n.config.ts (correct). `'i18n/vue-i18n.config.ts'` would be
    // looked up as i18n/i18n/vue-i18n.config.ts → "not found ... Skipping" → the
    // config (legacy:false) never loads → vue-i18n stays in LEGACY mode →
    // `useI18n().t` is undefined → every page dies with
    // `$setup.t is not a function` (blank 500 screen).
    vueI18n: "vue-i18n.config.ts",
    // The APP owns the language: it is stored in the settings snapshot and
    // seeded ONCE from the browser by core/prefs `detectLocale` on first run.
    // Browser detection on top of that silently overrode the user's explicit
    // choice on every cold start — on a phone whose browser is English the app
    // came up with dir=rtl (from the stored setting) but ENGLISH strings, which
    // is exactly the "Persian is not really applied" bug. init.client.ts also
    // watches settings.language and mirrors it into the locale.
    detectBrowserLanguage: false,
  },

  /* Site identity for @nuxtjs/sitemap (via nuxt-site-config): the absolute origin
   * every `<loc>` is built from — the same value robots.txt advertises. */
  site: {
    url: siteOrigin,
    name: "Telepatty",
    description: "Telepatty — serverless end-to-end encrypted messenger",
  },

  /* @nuxtjs/sitemap — the sitemap is generated, never authored:
   * - page routes (`/`, `/friends`, `/Magazine`, …) are discovered from the Nuxt
   *   page files (module default, on purpose: pages are the source of truth);
   * - the internal, auth-gated screens are removed again by `exclude` below: /add,
   *   /lock and /onboarding only render a form/overlay, carry no crawlable content
   *   and have no SEO value — indexing them would just be noise;
   * - article URLs come from `sitemap.urls`, resolved at BUILD time by the pure
   *   helpers in `core/Magazine/sitemap.ts` — the same markdown/frontmatter the app
   *   reads — so dropping a file into `content/Magazine/` is the only step needed
   *   for it to appear (and a `draft: true` file never appears);
   * - `autoLastmod` stays OFF (module default, pinned): `lastmod` must be the
   *   article's own date, never the moment the site was built, so a rebuild without
   *   content changes cannot claim every page changed.
   * `exclude` is matched against the URL PATHNAME of the FINAL merged URL set (the
   * module filters in its runtime builder), so it catches both the page and the
   * prerender source; the `/**` variants only guard against someone adding
   * `app/pages/add/…` later. Nothing else matches these patterns. */
  sitemap: {
    autoLastmod: false,
    exclude: [
      "/add",
      "/add/**",
      "/lock",
      "/lock/**",
      "/onboarding",
      "/onboarding/**",
    ],
    urls: () => sitemapUrls(MagazineArticles, { origin: siteOrigin, baseURL }),
  },

  pwa: {
    registerType: "prompt",
    includeAssets: ["favicon.ico", "robots.txt"],
    manifest: {
      id: `${baseURL}`,
      name: "Telepatty",
      short_name: "Telepatty",
      description: "Serverless end-to-end encrypted messenger",
      lang: "en",
      start_url: `${baseURL}`,

      scope: `${baseURL}`,
      display: "standalone",
      background_color: "#050807",
      theme_color: "#050807",
      launch_handler: { client_mode: "focus-existing" },
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "icons/maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      /* sitemap.xml / robots.txt are FILES shipped in public/, not app routes.
       * `xml` + `txt` keep them in the precache manifest, so the service worker can
       * answer with the real bytes (offline too) instead of having nothing to serve. */
      globPatterns: ["**/*.{js,css,html,xml,txt,png,svg,ico,woff,woff2}"],
      navigateFallback: `${baseURL}`,
      /* …and they must ALSO bypass the SPA navigation fallback. `navigateFallback`
       * is bound to `/` (`createHandlerBoundToURL('/')`), so opening
       * https://telepatty.ir/sitemap.xml in a browser (where the SW is active) was
       * answered with the app shell, the SPA router found no `/sitemap.xml` route
       * and rendered its 404 page — the reported "the sitemap is missing / 404"
       * even though the file is on the server (curl and Googlebot never run the SW
       * and always read the real XML). Only `/icons/` was denylisted before. */
      navigateFallbackDenylist: [
        /^\/icons\//,
        /^\/sitemap\.xml$/,
        /^\/robots\.txt$/,
      ],
      runtimeCaching: [],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    client: {
      installPrompt: false,
    },
    devOptions: { enabled: false },
  },
  nitro: {
    preset: "static",
    /* Each article gets its own prerendered entry so GitHub Pages answers 200
     * for the sitemap URLs instead of the 404 fallback. With ssr:false the
     * emitted HTML is still the app shell (no article text) — see
     * content/README.md for the SEO note. */
    prerender: {
      crawlLinks: true,
      routes: ["/Magazine", ...MagazineArticleRoutes],
    },
  },
  devtools: { enabled: false },
  hooks: {
    "nitro:build:public-assets": () => {
      // SPA fallback for GitHub Pages deep links
      const out = ".output/public";
      if (existsSync(out)) copyFileSync(`${out}/index.html`, `${out}/404.html`);
    },
    "nitro:init"(nitro) {
      // Inject per-article head tags + crawlable text into each prerendered
      // Magazine shell while it is generated (keeps `ssr: false` intact —
      // no server runtime, the messenger is untouched).
      // `prerender:generate` runs BEFORE the file is written and `contents`
      // is the buffer-backed property nitro actually persists.
      nitro.hooks.hook("prerender:generate", (route) => {
        if (typeof route.contents !== "string") return;
        const m = /\/Magazine(\/([^/?#]+))?(?:$|[?#])/.exec(route.route);
        if (!m) return;
        if (m[2]) {
          const article = loadMagazineSeoArticles().find(
            (a) => a.slug === m[2],
          );
          if (!article) return;
          // build-time warning when og:image falls back (SVG/WebP/missing cover)
          const image = resolveOgImage(article, {
            origin: siteOrigin,
            baseURL,
            exists: MagazineCoverExists,
          });
          if (image.warning) console.warn(image.warning);
          route.contents = injectIntoShell(
            route.contents,
            articleHeadHtml(article, {
              origin: siteOrigin,
              baseURL,
              exists: MagazineCoverExists,
            }),
            articleBodyHtml(article),
          );
        } else {
          route.contents = injectIntoShell(
            route.contents,
            listHeadHtml({ origin: siteOrigin, baseURL }),
            "",
          );
        }
      });
    },
  },
}) satisfies NuxtConfig;

declare global {
  const __APP_VERSION__: string;
}

export {};
