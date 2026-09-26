# Magazine (مجله) — content guide

This folder holds the Telepatty magazine. Files are plain markdown, parsed at
runtime in the browser (the app is `ssr: false`), lazy-loaded per article, and
everything is sanitized before rendering. Nothing here is sent to any server —
the magazine is as local as the messenger.

## Where things live

| Path                              | Purpose                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `content/Magazine/_categories.md` | Category definitions (frontmatter only). Files starting with `_` are never articles. |
| `content/Magazine/<slug>.md`      | One article per file. The slug (URL) is the file name without `.md`.                 |
| `public/media/`                   | Images/videos referenced by articles.                                                |

## Categories (`_categories.md`)

```md
---
categories:
  - id: tech
    name_en: Technology
    name_fa: "تکنولوژی"
    color: "#22d3ee"
---
```

- `id` — what articles reference in their `category:` field (required, unique).
- `name_en` / `name_fa` — display names per language.
- `color` — optional CSS color used for the chip.
- An article with a `category:` that has no matching `id` is still published,
  but shows no chip, and the build logs a clear warning.

## Article frontmatter

```md
---
title: "My article" # required — articles without a title are skipped
description: "Short summary" # used on cards, search and SEO meta
date: 2026-09-21 # YYYY-MM-DD (or full ISO)
category: tech # must match a category id (optional)
cover: /media/cover.png # local /media path (optional, see "Cover images")
author: "REZA" # optional
tags: ["tag1", "tag2"] # optional inline array or block list
draft: true # optional — draft articles are excluded from the build
---
```

## Cover images

- **Recommended: PNG or JPG, 1200×630** (the Open-Graph preview size). Save it
  under `public/media/` and reference it in the frontmatter (`cover: …`).
- SVG/WebP covers still render inside the page, but social scrapers need
  `og:image` as an absolute PNG/JPG URL — a non-PNG/JPG (or missing) cover
  falls back to `public/media/og-default.png` (1200×630 placeholder, generated
  by `pnpm icons`) and the build prints a warning naming the article.

`cover` accepts a bare file name (`cover.webp`) or a `/media/…` path; anything
else (`../…`, external URLs, schemes) is rejected with a warning.

## Body block directives

A **block** starts with a line `#name` and ends at the first of:

- a line containing only `#`
- a line containing only `--` (exactly two dashes — a markdown `---` is still a horizontal rule)
- the next `#name` line
- end of file

Plain markdown before the first directive is an implicit `#text` block.

| Directive         | Syntax                                                                                    | Renders as                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `#text` (default) | normal markdown: headings, lists, links, bold, code, tables                               | sanitized prose                                                                                  |
| `#media`          | one file per line: `name.jpg \| optional caption` — `.mp4/.webm/…` become videos          | responsive gallery/grid, lazy-loaded, reserved aspect ratio, lightbox for images, video controls |
| `#ad`             | line 1: `image \| alt` (optional) · line 2: `https://url` · line 3: text label (optional) | "تبلیغات"-labeled promo box; link gets `rel="sponsored noopener"`, no third-party scripts        |
| `#quote`          | markdown lines; a line that is only `\| source` sets the attribution                      | styled blockquote with source                                                                    |
| `#callout`        | first line `info` or `warning` (optional), then markdown                                  | info/warning note box                                                                            |
| `#source`         | `credit text \| https://url`                                                              | small credit line under an image/section                                                         |

Unknown directives are rendered as plain text and warn in the console, so a
typo never hides content.

### Example

```md
#text

## A heading

Normal **markdown** here.

#media
shot-1.webp | First screenshot
clip.mp4

#ad
banner.webp | Alt text
https://example.com
Promo text

#quote
Famous words | Someone

#callout
warning
Careful with this.

#source
MDN | https://developer.mozilla.org
```

## Media rules

- Only paths under `/media` are allowed (bare names are re-rooted under
  `/media/`). `../` escapes, external URLs and schemes are rejected.
- Missing files render a visible placeholder card, never a broken image.
- Inline markdown images must also be local `/media` files (CSP has no external
  image hosts, and external images would leak reader IPs).

## SEO, link previews & the sitemap

- The app is `ssr: false` (SPA) and **`sitemap.xml` is generated, never authored**:
  `@nuxtjs/sitemap` is registered in `nuxt.config.ts` and writes the file during
  `nuxt generate` — there is no `public/sitemap.xml` in the repo, and none may be
  added (the old hand-generated file is gone; `core/pwa-config.test.ts` fails if it
  comes back). Two sources feed it automatically:
  - **page routes** (`/`, `/add`, `/friends`, `/lock`, `/onboarding`, `/Magazine`,
    `/settings`) come from the Nuxt page files, i.e. `app/pages/**` is the source of
    truth (module default). To keep one out of the index, list it in
    `sitemap.exclude`.
  - **articles** come from this folder: `sitemap.urls` is resolved at build time by
    the pure helpers in `core/Magazine/sitemap.ts`, which read
    `content/Magazine/*.md` through the same frontmatter parser the app uses.
    Adding a markdown file is therefore the ONLY step needed for a new article to
    appear in the sitemap; `draft: true` files, title-less files and `_`-prefixed
    files (`_categories.md`) never do. `lastmod` is the article's own frontmatter
    date (`updated`/`updatedAt` beating `date`) — `autoLastmod` is pinned OFF, so a
    rebuild that changes no content cannot claim every page changed.
- `public/robots.txt` is still generated at build time and carries the matching
  `Sitemap: <origin>/sitemap.xml` line (submit exactly that URL in Google Search
  Console). The absolute URLs come from `TELEPATTY_ORIGIN`, which defaults to the
  published domain `https://telepatty.ir` — set the env var only to build for a
  different host (a preview, a mirror).
- `nuxt.config.ts` feeds those article routes into `nitro.prerender.routes`,
  so each sitemap URL gets its own `index.html` at build time. That matters on
  GitHub Pages: without it a deep link answers **404** (via the SPA fallback),
  and a 404 is never indexed. With the prerendered entry the URL answers 200.
- The **service worker** (`@vite-pwa/nuxt`) answers every navigation with the SPA
  shell, so the two crawler files are precached (`xml` + `txt` in the workbox
  `globPatterns`) **and** denylisted from `navigateFallback`
  (`/^\/sitemap\.xml$/`, `/^\/robots\.txt$/`). Without that, opening
  `https://telepatty.ir/sitemap.xml` in a browser renders the app's 404 page even
  though the file is on the server — curl/Googlebot never run the SW, so they always
  read the real XML (`core/pwa-config.test.ts` pins both halves).
- **At generate time** (a `prerender:route` hook in `nuxt.config.ts`, running
  inside plain `nuxt generate`) each prerendered shell is rewritten with the
  pure builders from `core/Magazine/seo.ts` (unit-tested):
  - per-article `<title>`, meta description, canonical
    (`<origin>/Magazine/<slug>/`), `og:title`, `og:description`,
    `og:type=article`, `og:url`, `og:image` (absolute PNG/JPG URL — falls back
    to `media/og-default.png` for SVG/WebP/missing covers, with a build
    warning), `twitter:card=summary_large_image` and
    `article:published_time`; the generic shell tags are stripped first so the
    document never carries two `<title>` tags. `/Magazine/` gets a generic
    version of the same tags.
  - the article **text as crawlable HTML** inside `<div id="__nuxt">`. The SPA
    replaces it when the article route mounts (there is no hydration at all
    with `ssr: false`, so there are no hydration errors and no wrong-content
    flash — the injected text is the article itself).
- Net effect: Google/Bing render the page with JS as before, and social
  scrapers (Telegram, X, WhatsApp, Discord) that do **not** execute JS now see
  the real article title, description and preview image in the static
  `<head>` — link previews work without enabling any server runtime.
