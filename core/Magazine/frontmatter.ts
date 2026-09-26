/**
 * Magazine (مجله) frontmatter — a pragmatic YAML-subset parser.
 *
 * Supports exactly what article/category headers need (see content/README.md),
 * mirroring the structure used in the reference portfolio project:
 * - `---` fenced header (first line must be `---`, closed by the next `---`)
 * - scalars: unquoted, 'single', "double" (numbers/booleans/ISO dates detected)
 * - inline arrays: `tags: [a, b, "c d"]`
 * - block lists:
 *     tags:
 *       - one
 *       - two
 * - block lists of one-level maps (like the reference project's `media:`):
 *     categories:
 *       - id: tech
 *         name_en: Technology
 *         name_fa: تکنولوژی
 * No deep nesting, no anchors, no multiline `|` scalars — by design.
 */

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

const KEY = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const DASH = /^-\s+(.*)$/;

/** Split off a leading `--- … ---` frontmatter block (empty meta when absent). */
export function splitFrontmatter(raw: string): FrontmatterResult {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.slice(3).search(/^---\s*$/m);
  if (end < 0) return { data: {}, body: text };
  const header = text.slice(3, 3 + end);
  const body = text
    .slice(3 + end)
    .replace(/^---[^\n]*\n?/, "")
    .replace(/^\n+/, "");
  return { data: parseYamlSubset(header), body };
}

export function parseYamlSubset(src: string): Record<string, unknown> {
  const lines = String(src ?? "").split("\n");
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line: string = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const m = KEY.exec(line);
    if (!m) {
      i += 1;
      continue; // tolerate junk lines instead of throwing
    }
    const key: string = m[1]!;
    const rest = (m[2] ?? "").trim();
    i += 1;
    if (rest !== "") {
      out[key] = coerceScalar(rest);
      continue;
    }
    out[key] = parseBlockList(lines, i, (next) => (i = next));
  }
  return out;
}

/** Collect an indented `- item` list; `- key: value` items become flat maps. */
function parseBlockList(
  lines: string[],
  start: number,
  seek: (next: number) => void,
): unknown[] {
  const items: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const raw: string = lines[i]!;
    if (!raw.trim()) {
      i += 1;
      continue;
    }
    if (raw.length - raw.trimStart().length === 0) break; // dedent → parent scope
    const dash = DASH.exec(raw.trim());
    if (!dash) break; // not a list item → let the parent key loop handle it
    i += 1;
    const first = (dash[1] ?? "").trim();
    const kv = KEY.exec(first);
    if (!kv) {
      items.push(coerceScalar(first));
      continue;
    }
    // map item: first key sits on the dash line, continuation `key: value`
    // lines (any indentation, blank lines allowed) belong to the same item
    const item: Record<string, unknown> = {
      [kv[1]!]: coerceScalar(kv[2] ?? ""),
    };
    while (i < lines.length) {
      const raw2: string = lines[i]!;
      if (!raw2.trim()) {
        i += 1;
        continue;
      }
      if (raw2.length - raw2.trimStart().length === 0) break;
      const t2 = raw2.trim();
      if (t2.startsWith("- ") || !KEY.test(t2)) break;
      const kv2 = KEY.exec(t2)!;
      item[kv2[1]!] = coerceScalar(kv2[2] ?? "");
      i += 1;
    }
    items.push(item);
  }
  seek(i);
  return items;
}

/** Inline value coercion: quotes, numbers, booleans, ISO dates, [arrays]. */
export function coerceScalar(v: string): unknown {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  )
    return s.slice(1, -1);
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(s)) return s; // dates stay strings
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith("[") && s.endsWith("]")) {
    return s
      .slice(1, -1)
      .split(",")
      .map((x) => unquote(x.trim()))
      .filter((x) => x !== "");
  }
  return s;
}

function unquote(s: string): string {
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  )
    return s.slice(1, -1);
  return s;
}
