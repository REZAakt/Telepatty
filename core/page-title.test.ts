import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pageTitle } from "./page-title";

/* ---------------------------- the pure pattern ---------------------------- */

describe("pageTitle (browser-tab titles)", () => {
  it("joins the screen name and the app name with the em dash the SEO tags use", () => {
    expect(pageTitle("Chats", "Telepatty")).toBe("Chats — Telepatty");
    expect(pageTitle("گفتگوها", "Telepatty")).toBe("گفتگوها — Telepatty");
    expect(pageTitle("تنظیمات", "Telepatty")).toBe("تنظیمات — Telepatty");
  });

  it("never leaves a dangling separator (a missing half is not an error)", () => {
    expect(pageTitle("", "Telepatty")).toBe("Telepatty");
    expect(pageTitle("   ", "Telepatty")).toBe("Telepatty");
    expect(pageTitle("Chats", "")).toBe("Chats");
    expect(pageTitle("  Chats  ", " Telepatty ")).toBe("Chats — Telepatty");
  });

  it("does not repeat the app name when the screen string already carries it", () => {
    expect(pageTitle("Telepatty قفل است", "Telepatty")).toBe(
      "Telepatty قفل است",
    );
    expect(pageTitle("Welcome to Telepatty", "Telepatty")).toBe(
      "Welcome to Telepatty",
    );
  });
});

/* ------------------------------- grep guard ------------------------------- */

/**
 * Every screen must title itself, and the title must come from i18n (`t(...)`)
 * so it follows the selected language — that is what `usePageTitle()` is for.
 * Before this, only the two Magazine pages set a head and every other tab just
 * read "Telepatty"; a NEW page silently going back to that is what this fails on.
 */
function collectPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectPages(p, out);
    else if (name.endsWith(".vue") && !name.includes(".test.")) out.push(p);
  }
  return out;
}

describe("every page titles the browser tab (grep guard)", () => {
  it("each app/pages file sets a translated title", () => {
    const files = collectPages(join(process.cwd(), "app/pages"));
    expect(files.length).toBeGreaterThan(5);
    const offenders = files
      .filter((f) => !/usePageTitle\(|\btitle:/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), ""));
    expect(offenders).toEqual([]);
  });

  it("the Magazine list title matches its own build-time SEO title", () => {
    const src = readFileSync(
      join(process.cwd(), "app/pages/Magazine/index.vue"),
      "utf8",
    );
    expect(pageTitle("Magazine", "Telepatty")).toBe("Magazine — Telepatty");
    expect(src).toMatch(/title:\s*pageTitle\(/);
  });

  /**
   * Adding a magazine post is dropping ONE `.md` file into `content/Magazine/`
   * — so an article page must take its title from the loaded article data, never
   * from a list written by hand (which is why the title needs no code change for
   * a new post; the final `— Telepatty` form is not appended there on purpose:
   * the article's own title IS what the build-time `<title>`/og:title ship).
   */
  it("an article titles itself from the article data — a new .md needs no code change", () => {
    const src = readFileSync(
      join(process.cwd(), "app/pages/Magazine/[slug].vue"),
      "utf8",
    );
    expect(src).toMatch(/title:\s*a\.title/);
    expect(src).toMatch(/if \(!a\) return \{ title: pageTitle\(/);
    expect(src).not.toMatch(/title:\s*['"`][^'"`]*Magazine-(welcome|update)/);
  });

  it("the magazine reads its posts from a build-time glob, not a hand-written list", () => {
    const src = readFileSync(
      join(process.cwd(), "app/composables/useMagazine.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /import\.meta\.glob\(["']\.\.\/\.\.\/content\/Magazine\/\*\.md["']/,
    );
  });
});
