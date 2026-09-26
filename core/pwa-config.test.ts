import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listArticles } from "./Magazine/sitemap";

/**
 * Guard for the wiring bug behind "https://telepatty.ir/sitemap.xml is missing and
 * answers 404": the PWA service worker answers EVERY navigation with the SPA shell
 * (`createHandlerBoundToURL('/')`), so `/sitemap.xml` and `/robots.txt` must both be
 * precached and denylisted from that fallback — otherwise a browser gets the app
 * shell, the SPA router finds no such route and renders the in-app 404 page, while
 * curl/Googlebot (no service worker) read the real XML.
 *
 * The config is read from disk and its OWN globs/regexes are re-run here, so this
 * fails the moment someone drops `xml`/`txt` from the precache glob or a crawler
 * file from the denylist — not merely when a comment disappears.
 */
const raw = readFileSync(join(process.cwd(), "nuxt.config.ts"), "utf8");

/** Text inside the first `key: [ ... ]` literal in the file. */
function arrayLiteral(key: string): string {
  const m = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(raw);
  expect(m, `${key} must be configured in nuxt.config.ts`).not.toBeNull();
  return m![1];
}

/** The workbox `globPatterns` entries (what `workbox-precaching` walks at build time). */
function precacheGlobs(): string[] {
  return [...arrayLiteral("globPatterns").matchAll(/[\"']([^\"']+)[\"']/g)].map(
    (m) => m[1],
  );
}

/** The `navigateFallbackDenylist` regex literals, compiled exactly as workbox does. */
function navigationDenyList(): RegExp[] {
  return [
    ...arrayLiteral("navigateFallbackDenylist").matchAll(
      /\/((?:\\.|[^/\\])+)\/([a-z]*)/g,
    ),
  ].map((m) => new RegExp(m[1], m[2]));
}

/** Minimal brace-glob → RegExp for the shapes workbox/the module use (`**`, `*`, `{a,b}`). */
function globToRegExp(glob: string): RegExp {
  const patterns = [glob];
  const brace = /\{([^}]+)\}/.exec(glob);
  if (brace) {
    patterns.splice(
      0,
      1,
      ...brace[1].split(",").map((alt) => glob.replace(brace[0], alt.trim())),
    );
  }
  const sources = patterns.map((p) =>
    p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // literal dots/braces… (`*` and `/` stay)
      .replace(/\*\*\//g, "\u0000") // `**/` = any depth
      .replace(/\/\*\*$/g, "\u0001") // trailing `/**` = this path and everything under it
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, "(?:/.*)?"),
  );
  return new RegExp(`^(?:${sources.join("|")})$`);
}

describe("crawler files vs the PWA navigation fallback", () => {
  it("precaches sitemap.xml and robots.txt (xml/txt are in the workbox glob)", () => {
    const globs = precacheGlobs();
    const cached = (file: string) =>
      globs.some((g) => globToRegExp(g).test(file));

    expect(cached("sitemap.xml")).toBe(true);
    expect(cached("robots.txt")).toBe(true);
    // no regression: the shell, the bundles, the fonts and the icons stay precached
    for (const file of [
      "index.html",
      "_nuxt/entry.js",
      "favicon.ico",
      "icons/icon-192.png",
    ]) {
      expect(cached(file), file).toBe(true);
    }
  });

  it("never answers a browser navigation to a crawler file with the SPA shell", () => {
    const denied = (path: string) =>
      navigationDenyList().some((re) => re.test(path));

    expect(denied("/sitemap.xml")).toBe(true);
    expect(denied("/robots.txt")).toBe(true);
    expect(denied("/icons/icon-192.png")).toBe(true); // pre-existing rule, kept
    // the SPA fallback still owns the real app routes (deep links keep working)
    for (const route of [
      "/",
      "/friends",
      "/Magazine",
      "/Magazine/add-friends",
      "/settings",
    ]) {
      expect(denied(route), route).toBe(false);
    }
  });

  it("keeps a navigation fallback bound to the shell", () => {
    expect(/navigateFallback:\s*`\$\{baseURL\}`/.test(raw)).toBe(true);
  });
});

describe("@nuxtjs/sitemap wiring (the sitemap is generated, never authored)", () => {
  it("registers the module and pins lastmod to the content, not the build clock", () => {
    expect(arrayLiteral("modules")).toMatch(/[\"']@nuxtjs\/sitemap[\"']/);
    expect(/sitemap:\s*\{[\s\S]*?autoLastmod:\s*false/.test(raw)).toBe(true);
    // the article URLs are handed to the module by the pure content helpers
    expect(
      /sitemap:\s*\{[\s\S]*?urls:\s*\(\)\s*=>\s*sitemapUrls\(/.test(raw),
    ).toBe(true);
    expect(/site:\s*\{[\s\S]*?url:\s*siteOrigin/.test(raw)).toBe(true);
  });

  it("ships NO hand-written sitemap, and robots.txt points at the generated one", () => {
    expect(existsSync(join(process.cwd(), "public/sitemap.xml"))).toBe(false);
    const robots = readFileSync(
      join(process.cwd(), "public/robots.txt"),
      "utf8",
    );
    expect(robots).toContain("Sitemap: https://telepatty.ir/sitemap.xml");
  });
});

describe("the internal app screens stay out of the sitemap", () => {
  /** `sitemap.exclude` globs, compiled the way the module matches URL pathnames. */
  const excludePatterns = () =>
    [...arrayLiteral("exclude").matchAll(/[\"']([^\"']+)[\"']/g)].map((m) =>
      globToRegExp(m[1]!),
    );
  const excluded = (path: string) =>
    excludePatterns().some((re) => re.test(path));

  it("excludes /add, /lock and /onboarding (and any future subroute under them)", () => {
    for (const path of [
      "/add",
      "/lock",
      "/onboarding",
      "/add/invite",
      "/lock/verify",
      "/onboarding/step-2",
    ]) {
      expect(excluded(path), path).toBe(true);
    }
  });

  it("touches no indexable page and no article", () => {
    const kept = [
      "/",
      "/friends",
      "/settings",
      "/Magazine",
      "/Magazine/add-friends",
      "/Magazine/hello-Magazine",
    ];
    for (const path of kept) expect(excluded(path), path).toBe(false);
  });

  /** Runs only when a build is present (CI checks it right after `pnpm test`; locally after `pnpm generate`). */
  const OUTPUT = join(process.cwd(), ".output/public/sitemap.xml");
  it.skipIf(!existsSync(OUTPUT))(
    "the generated sitemap.xml has exactly the 4 pages + every published article",
    () => {
      const locs = [
        ...readFileSync(OUTPUT, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g),
      ].map((m) => m[1]!);
      expect(locs.filter((l) => /\/(add|lock|onboarding)$/.test(l))).toEqual(
        [],
      );
      for (const kept of [
        "https://telepatty.ir/",
        "https://telepatty.ir/friends",
        "https://telepatty.ir/settings",
        "https://telepatty.ir/Magazine",
      ]) {
        expect(locs, kept).toContain(kept);
      }
      /* The article half is NOT a magic number: it is every published markdown file,
       * read with the same pure helper `sitemap.urls` is wired to. A hardcoded count
       * went stale the moment the 5th article was committed (the guard reported a
       * failure that had nothing to do with a regression), so the expectation now
       * follows `content/Magazine/` — adding or deleting an article updates it. */
      const articles = listArticles(join(process.cwd(), "content/Magazine"));
      for (const a of articles)
        expect(locs, a.slug).toContain(
          `https://telepatty.ir/Magazine/${a.slug}`,
        );
      expect(locs.length).toBe(4 + articles.length);
    },
  );
});
