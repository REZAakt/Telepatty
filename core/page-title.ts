/**
 * The browser-tab title of a screen: `<page> — <app name>`.
 *
 * ONE place decides the shape, so every screen carries the app name and both
 * languages get the same form (`گفتگوها — Telepatty`, `Chats — Telepatty`). The
 * em-dash form is not invented here: the build-time SEO tags of the magazine
 * already ship `Magazine — Telepatty` (`core/Magazine/seo.ts`), so the tab
 * title and the crawler-visible one cannot drift apart.
 *
 * Neither half is mandatory: a page without a name of its own falls back to the
 * bare app name and vice versa, and a page string that ALREADY names the app
 * ("Telepatty is locked") is passed through instead of reading
 * «Telepatty قفل است — Telepatty».
 */
export function pageTitle(page: string, appName: string): string {
  const p = String(page ?? "").trim();
  const a = String(appName ?? "").trim();
  if (!p) return a;
  if (!a) return p;
  if (p.toLowerCase().includes(a.toLowerCase())) return p;
  return `${p} — ${a}`;
}
