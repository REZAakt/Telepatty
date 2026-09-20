import process from 'node:process'
import { execSync } from 'node:child_process'
import { readFileSync, copyFileSync, existsSync } from 'node:fs'
import type { NuxtConfig } from 'nuxt/config'


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
        'lucide:folder', 'lucide:folder-open', 'lucide:grip-vertical', 'lucide:hard-drive', 'lucide:hash',
        'lucide:info', 'lucide:key-round', 'lucide:languages', 'lucide:lightbulb', 'lucide:link',
        'lucide:unlink', 'lucide:loader-circle', 'lucide:lock', 'lucide:lock-keyhole', 'lucide:menu',
        'lucide:message-square', 'lucide:message-square-off', 'lucide:minus', 'lucide:monitor', 'lucide:moon',
        'lucide:more-horizontal', 'lucide:more-vertical', 'lucide:network', 'lucide:palette',
        'lucide:panel-left-close', 'lucide:panel-left-open', 'lucide:pencil', 'lucide:pin', 'lucide:pin-off',
        'lucide:plus', 'lucide:qr-code', 'lucide:refresh-cw', 'lucide:reply', 'lucide:rotate-ccw',
        'lucide:scan-eye', 'lucide:scroll-text', 'lucide:search', 'lucide:send', 'lucide:server',
        'lucide:settings', 'lucide:share-2', 'lucide:shield', 'lucide:shield-check', 'lucide:shield-x',
        'lucide:square', 'lucide:star', 'lucide:sun', 'lucide:timer', 'lucide:trash-2', 'lucide:triangle-alert',
        'lucide:upload', 'lucide:user', 'lucide:user-plus', 'lucide:users', 'lucide:user-x', 'lucide:wifi',
        'lucide:wifi-off', 'lucide:x',
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  app: {
    baseURL,
    head: {
      title: 'Telepatty',
      htmlAttrs: { lang: 'en' },
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
      { code: 'fa', language: 'fa-IR', name: 'فارسی', file: 'fa.json' },
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
  },
  devtools: { enabled: false },
  hooks: {
    'nitro:build:public-assets': () => {
      // SPA fallback for GitHub Pages deep links
      const out = '.output/public'
      if (existsSync(out)) copyFileSync(`${out}/index.html`, `${out}/404.html`)
    },
  },
}) satisfies NuxtConfig


declare global {
  const __APP_VERSION__: string
}

export {}

