import process from 'node:process'
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NuxtConfig } from 'nuxt/config'
import { PREFS_BOOT_SCRIPT } from './core/prefs-inline'
import { articleBodyHtml, articleHeadHtml, injectIntoShell, listHeadHtml, resolveOgImage } from './core/rooznameh/seo'
import { buildArticle, byNewest, normalizeCategories, type RzArticle } from './core/rooznameh/articles'
import { splitFrontmatter } from './core/rooznameh/frontmatter'


const baseURL = process.env.TELEPATTY_BASE_URL || '/'
/** Build-time flag: in `nuxt dev` the PWA SW/manifest are disabled, so the
 *  manifest <link> is omitted to avoid browser "Manifest: Syntax error" noise
 *  (the dev server has no webmanifest file to serve). */
const isProd = process.env.NODE_ENV === 'production'


let appVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
  let sha = ''
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    /* no git (e.g. CI tarball) */
  }
  appVersion = sha ? `${pkg.version}+${sha}` : pkg.version
} catch {
  /* keep fallback */
}

/* Rooznameh sitemap: every non-draft article + the main static pages, generated
 * at build time into public/sitemap.xml. Absolute URLs need an origin — set
 * TELEPATTY_ORIGIN (defaults to the GitHub Pages project URL). Also parses
 * category validation so frontmatter mistakes surface in the build log.
 * Returns the article routes so Nitro can prerender a shell for each of them
 * (a sitemap URL that answers 404 is never indexed). */
const siteOrigin = (process.env.TELEPATTY_ORIGIN || 'https://rezaakt.github.io').replace(/\/$/, '')

function makeRooznamehSitemap(): string[] {
  try {
    const dir = new URL('./content/rooznameh', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    const base = `${siteOrigin}${baseURL === '/' ? '' : baseURL.replace(/\/$/, '')}`
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // regex-based header scan (config time must stay dependency-free; the full
    // parser + category validation runs in the app and in the unit tests)
    const articles: { slug: string; date: string }[] = []
    for (const f of files) {
      if (f.startsWith('_')) continue
      const raw = readFileSync(new URL(`./content/rooznameh/${f}`, import.meta.url), 'utf8')
      const header = raw.split(/^---$/m)[1] ?? ''
      if (/^\s*draft:\s*(true|yes)\s*$/m.test(header)) continue
      const dateMatch = /^\s*date:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m.exec(header)
      articles.push({ slug: f.replace(/\.md$/, ''), date: dateMatch?.[1] ?? '' })
    }

    const entries: { loc: string; lastmod?: string }[] = [
      { loc: `${base}/` },
      { loc: `${base}/friends` },
      { loc: `${base}/rooznameh` },
      ...articles.map((a) => ({ loc: `${base}/rooznameh/${a.slug}`, lastmod: a.date || undefined })),
    ]

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map((e) => `  <url><loc>${escape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`),
      '</urlset>',
      '',
    ].join('\n')
    writeFileSync(new URL('./public/sitemap.xml', import.meta.url), xml)
    return articles.map((a) => `/rooznameh/${a.slug}`)
  } catch {
    /* no content dir yet — skip quietly */
    return []
  }
}
const rooznamehArticleRoutes = makeRooznamehSitemap()

/* Generate-time SEO: the prerendered shells (ssr:false → bare app HTML) are
 * rewritten per article with real head tags + crawlable text — pure builders
 * in core/rooznameh/seo.ts (unit-tested), fs + wiring here. Reuses the SAME
 * parse path as the app (buildArticle), so a content typo can't diverge. */
let rooznamehSeoArticles: RzArticle[] | null = null
function loadRooznamehSeoArticles(): RzArticle[] {
  if (rooznamehSeoArticles) return rooznamehSeoArticles
  const list: RzArticle[] = []
  try {
    const dir = new URL('./content/rooznameh', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    const raws = new Map<string, string>()
    for (const f of files) {
      raws.set(f.replace(/\.md$/, ''), readFileSync(new URL(`./content/rooznameh/${f}`, import.meta.url), 'utf8'))
    }
    const categories = normalizeCategories(splitFrontmatter(raws.get('_categories') ?? '').data)
    for (const [slug, raw] of raws) {
      if (slug.startsWith('_')) continue
      const { article, warnings } = buildArticle(slug, raw, categories, baseURL)
      for (const w of warnings) console.warn(w)
      if (article) list.push(article)
    }
  } catch (e) {
    console.warn('[rooznameh] SEO article load failed — prerendered shells stay generic', e)
  }
  rooznamehSeoArticles = list.sort(byNewest)
  return rooznamehSeoArticles
}

/** Cover files live in public/ (copied verbatim into the build output). */
const rooznamehCoverExists = (cover: string): boolean =>
  existsSync(join(fileURLToPath(new URL('./public', import.meta.url)), cover))

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  typescript: { strict: true, typeCheck: false },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@pinia/nuxt', '@vite-pwa/nuxt', '@vueuse/nuxt'],
  /* Icons are compiled into the client bundle from the locally installed
   * `@iconify-json/lucide` collection. Nothing is fetched from
   * api.iconify.design at runtime — the CSP forbids it and the PWA must work
   * fully offline. The list covers every icon used in app/ plus the Nuxt UI
   * component defaults. */
  icon: {
    provider: 'none',
    fallbackToApi: false,
    clientBundle: {
      icons: [
        'lucide:alert-circle', 'lucide:alert-octagon', 'lucide:archive', 'lucide:arrow-down', 'lucide:arrow-left',
        'lucide:arrow-right', 'lucide:arrow-up', 'lucide:arrow-up-right', 'lucide:badge-check', 'lucide:ban',
        'lucide:bell', 'lucide:bell-off', 'lucide:camera', 'lucide:check', 'lucide:check-check',
        'lucide:chevron-down', 'lucide:chevron-left', 'lucide:chevron-right', 'lucide:chevrons-left',
        'lucide:chevrons-right', 'lucide:chevron-up', 'lucide:circle-alert', 'lucide:circle-check',
        'lucide:circle-help', 'lucide:circle-x', 'lucide:clipboard', 'lucide:clock', 'lucide:copy',
        'lucide:copy-check', 'lucide:database', 'lucide:database-backup', 'lucide:download', 'lucide:ellipsis',
        'lucide:eraser', 'lucide:eye', 'lucide:eye-off', 'lucide:file', 'lucide:file-json', 'lucide:file-text',
        'lucide:film', 'lucide:folder', 'lucide:folder-open', 'lucide:grip-vertical', 'lucide:hard-drive', 'lucide:hash',
        'lucide:image', 'lucide:image-off', 'lucide:info', 'lucide:key-round', 'lucide:languages', 'lucide:lightbulb', 'lucide:link',
        'lucide:paperclip',
        'lucide:unlink', 'lucide:loader-circle', 'lucide:lock', 'lucide:lock-keyhole', 'lucide:menu',
        'lucide:message-square', 'lucide:message-square-off', 'lucide:minus', 'lucide:monitor', 'lucide:moon',
        'lucide:more-horizontal', 'lucide:more-vertical', 'lucide:network', 'lucide:newspaper', 'lucide:palette',
        'lucide:panel-left-close', 'lucide:panel-left-open', 'lucide:pencil', 'lucide:pin', 'lucide:pin-off',
        'lucide:plus', 'lucide:qr-code', 'lucide:refresh-cw', 'lucide:reply', 'lucide:rotate-ccw',
        'lucide:scan-eye', 'lucide:scroll-text', 'lucide:search', 'lucide:send', 'lucide:server',
        'lucide:settings', 'lucide:share-2', 'lucide:shield', 'lucide:shield-check', 'lucide:shield-x',
        'lucide:square', 'lucide:star', 'lucide:sun', 'lucide:timer', 'lucide:trash-2', 'lucide:triangle-alert',
        'lucide:upload', 'lucide:user', 'lucide:user-plus', 'lucide:users', 'lucide:user-x', 'lucide:calendar', 'lucide:tag',
        'lucide:wifi', 'lucide:wifi-off', 'lucide:x',
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  app: {
    baseURL,
    head: {
      title: 'Telepatty',
      htmlAttrs: { lang: 'en' },
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
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Telepatty — serverless end-to-end encrypted messenger' },
        { name: 'theme-color', content: '#050807' },
        {
          'http-equiv': 'Content-Security-Policy',
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
          ].join('; '),
        },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: `${baseURL}icons/icon-192.png` },
        { rel: 'apple-touch-icon', href: `${baseURL}icons/icon-192.png` },
        ...(isProd ? [{ rel: 'manifest' as const, href: `${baseURL}manifest.webmanifest` }] : []),
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
      { name: 'Vazirmatn', provider: 'google', weights: [400, 500, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 600] },
    ],
  },
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      // `dir` is what makes useLocaleHead()/the i18n runtime emit dir="rtl" for fa.
      { code: 'fa', language: 'fa-IR', name: 'فارسی', file: 'fa.json', dir: 'rtl' },
    ],
    vueI18n: 'vue-i18n.config.ts',


    detectBrowserLanguage: { useCookie: false, fallbackLocale: 'en' },
  },

  pwa: {
    registerType: 'prompt',
    includeAssets: ['favicon.ico', 'robots.txt'],
    manifest: {
      id: `${baseURL}`,
      name: 'Telepatty',
      short_name: 'Telepatty',
      description: 'Serverless end-to-end encrypted messenger',
      lang: 'en',
      start_url: `${baseURL}`,

      scope: `${baseURL}`,
      display: 'standalone',
      background_color: '#050807',
      theme_color: '#050807',
      launch_handler: { client_mode: 'focus-existing' },
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
      navigateFallback: `${baseURL}`,
      navigateFallbackDenylist: [/^\/icons\//],
      runtimeCaching: [],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    client: {
      installPrompt: false,
    },
    devOptions: { enabled: false },
  },
  nitro: {
    preset: 'static',
    /* Each article gets its own prerendered entry so GitHub Pages answers 200
     * for the sitemap URLs instead of the 404 fallback. With ssr:false the
     * emitted HTML is still the app shell (no article text) — see
     * content/README.md for the SEO note. */
    prerender: {
      crawlLinks: true,
      routes: ['/rooznameh', ...rooznamehArticleRoutes],
    },
  },
  devtools: { enabled: false },
  hooks: {
    'nitro:build:public-assets': () => {
      // SPA fallback for GitHub Pages deep links
      const out = '.output/public'
      if (existsSync(out)) copyFileSync(`${out}/index.html`, `${out}/404.html`)
    },
    'nitro:init'(nitro) {
      // Inject per-article head tags + crawlable text into each prerendered
      // Rooznameh shell while it is generated (keeps `ssr: false` intact —
      // no server runtime, the messenger is untouched).
      // `prerender:generate` runs BEFORE the file is written and `contents`
      // is the buffer-backed property nitro actually persists.
      nitro.hooks.hook('prerender:generate', (route) => {
        if (typeof route.contents !== 'string') return
        const m = /\/rooznameh(\/([^/?#]+))?(?:$|[?#])/.exec(route.route)
        if (!m) return
        if (m[2]) {
          const article = loadRooznamehSeoArticles().find((a) => a.slug === m[2])
          if (!article) return
          // build-time warning when og:image falls back (SVG/WebP/missing cover)
          const image = resolveOgImage(article, { origin: siteOrigin, baseURL, exists: rooznamehCoverExists })
          if (image.warning) console.warn(image.warning)
          route.contents = injectIntoShell(
            route.contents,
            articleHeadHtml(article, { origin: siteOrigin, baseURL, exists: rooznamehCoverExists }),
            articleBodyHtml(article),
          )
        } else {
          route.contents = injectIntoShell(route.contents, listHeadHtml({ origin: siteOrigin, baseURL }), '')
        }
      })
    },
  },
}) satisfies NuxtConfig


declare global {
  const __APP_VERSION__: string
}

export {}

