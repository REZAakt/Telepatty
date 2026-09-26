import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";
import {
  articleRoutes,
  basePath,
  listArticles,
  normaliseLastmod,
  sitemapUrls,
} from "./sitemap";

const ORIGIN = "https://telepatty.ir";
/** The REAL content folder — the source of truth the build reads. */
const CONTENT_DIR = join(process.cwd(), "content/Magazine");

/** Temp markdown files this suite drops into `content/` (always removed again). */
const tempFiles: string[] = [];
function addTempArticle(
  name: string,
  frontmatter: string,
  body = "Body text.",
): string {
  const file = join(CONTENT_DIR, name);
  writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
  tempFiles.push(file);
  return file;
}
function removeTempArticle(file: string): void {
  if (existsSync(file)) unlinkSync(file);
  const i = tempFiles.indexOf(file);
  if (i >= 0) tempFiles.splice(i, 1);
}
afterEach(() => {
  while (tempFiles.length) removeTempArticle(tempFiles[tempFiles.length - 1]!);
});

const urls = () => sitemapUrls(listArticles(CONTENT_DIR), { origin: ORIGIN });
const locs = () => urls().map((u) => u.loc);
const entryFor = (slug: string) =>
  urls().find((u) => u.loc.endsWith(`/Magazine/${slug}`));

describe("a new markdown file is all it takes to enter the sitemap", () => {
  const NAME = "tmp-sitemap-article.md";

  it("adds the article URL on the next build, with ITS frontmatter date — and drops it when the file is gone", () => {
    expect(locs()).not.toContain(`${ORIGIN}/Magazine/tmp-sitemap-article`);

    const file = addTempArticle(
      NAME,
      "title: 'Temp sitemap article'\ndate: 2026-01-02",
    );
    expect(locs()).toContain(`${ORIGIN}/Magazine/tmp-sitemap-article`);
    expect(entryFor("tmp-sitemap-article")?.lastmod).toBe("2026-01-02");
    // the same file also feeds the prerender list, so the URL answers 200, not 404
    expect(articleRoutes(listArticles(CONTENT_DIR))).toContain(
      "/Magazine/tmp-sitemap-article",
    );

    removeTempArticle(file); // deleting the content removes the URL — nothing else to edit
    expect(locs()).not.toContain(`${ORIGIN}/Magazine/tmp-sitemap-article`);
  });

  it("matches the published markdown exactly (the count the build logs)", () => {
    const files = readdirSync(CONTENT_DIR).filter(
      (f) => f.endsWith(".md") && !f.startsWith("_"),
    );
    const expected = files.filter((f) => {
      const { data } = splitFrontmatter(
        readFileSync(join(CONTENT_DIR, f), "utf8"),
      );
      return (
        data.draft !== true &&
        data.draft !== "true" &&
        String(data.title ?? "").trim() !== ""
      );
    });
    expect(urls().length).toBe(expected.length);
    // every entry is absolute, unique and lives under the Magazine path
    const entries = urls();
    expect(new Set(entries.map((e) => e.loc)).size).toBe(entries.length);
    expect(entries.every((e) => e.loc.startsWith(`${ORIGIN}/Magazine/`))).toBe(
      true,
    );
  });
});

describe("excluded files never reach the sitemap (same rules as the app)", () => {
  it("skips drafts, title-less files and `_`-prefixed files", () => {
    addTempArticle(
      "tmp-draft.md",
      "title: 'Draft'\ndate: 2026-01-03\ndraft: true",
    );
    addTempArticle(
      "tmp-draft-string.md",
      "title: 'Draft'\ndate: 2026-01-03\ndraft: 'true'",
    );
    addTempArticle("tmp-notitle.md", "date: 2026-01-04");
    addTempArticle(
      "_tmp-partial.md",
      "title: 'Looks like an article'\ndate: 2026-01-05",
    );

    const all = locs().join(" ");
    expect(all).not.toContain("tmp-draft");
    expect(all).not.toContain("tmp-notitle");
    expect(all).not.toContain("_tmp-partial");
    // the real, published articles are untouched by the experiment above
    expect(locs()).toContain(`${ORIGIN}/Magazine/hello-Magazine`);
  });
});

describe("dates come from the content, never from the build clock", () => {
  it("reads date, lets updated/updatedAt win and truncates full ISO stamps", () => {
    expect(normaliseLastmod("2026-09-21")).toBe("2026-09-21");
    expect(normaliseLastmod("2026-09-21T10:30:00Z")).toBe("2026-09-21");
    expect(normaliseLastmod("21/09/2026")).toBe("");
    expect(normaliseLastmod(20260921)).toBe("");
    expect(normaliseLastmod(undefined)).toBe("");
  });

  it('an article without a date gets NO lastmod at all (never "now")', () => {
    addTempArticle("tmp-nodate.md", "title: 'No date'");
    expect(entryFor("tmp-nodate")).toEqual({
      loc: `${ORIGIN}/Magazine/tmp-nodate`,
    });
    expect("lastmod" in entryFor("tmp-nodate")!).toBe(false);

    addTempArticle(
      "tmp-updated.md",
      "title: 'Updated'\ndate: 2026-01-02\nupdated: 2026-03-04",
    );
    expect(entryFor("tmp-updated")?.lastmod).toBe("2026-03-04");
  });
});

describe("url shapes", () => {
  it("prefixes the origin + baseURL and never doubles slashes", () => {
    expect(basePath("/")).toBe("");
    expect(basePath(undefined)).toBe("");
    expect(basePath("/preview/")).toBe("/preview");
    expect(basePath("preview")).toBe("/preview");
    expect(
      sitemapUrls([{ slug: "a", lastmod: "" }], {
        origin: "https://telepatty.ir/",
        baseURL: "/preview/",
      }),
    ).toEqual([{ loc: "https://telepatty.ir/preview/Magazine/a" }]);
  });

  it("articleRoutes() mirrors the URL slugs as app routes", () => {
    expect(
      articleRoutes([
        { slug: "x", lastmod: "2026-01-01" },
        { slug: "y", lastmod: "" },
      ]),
    ).toEqual(["/Magazine/x", "/Magazine/y"]);
  });
});
