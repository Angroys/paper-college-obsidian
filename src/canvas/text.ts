/**
 * Small pure helpers ported from the web app (the plugin cannot import from
 * the Next.js tree): explain-label stripping (`src/lib/explain/parse.ts`),
 * type tags (`src/lib/glossary/tags.ts`), plus deterministic compare/round and
 * a rough text-size estimate for node sizing.
 */

const SECTION_LABEL_RE =
  /^[ \t]*(?:\*{1,2}|_{1,2})?(?:In\s+plain\s+words|Plain\s+words|Plain\s+English|Mathematical|Mathematics|Math)(?:\*{1,2}|_{1,2})?\s*:(?:\*{1,2}|_{1,2})?\s*/gim;

/** Copy of `stripExplainSectionLabels` in `src/lib/explain/parse.ts`. */
export function stripExplainSectionLabels(text: string): string {
  return text.replace(SECTION_LABEL_RE, "").trim();
}

/** Copy of `TYPE_TAGS` in `src/lib/glossary/tags.ts`. */
export const TYPE_TAGS = [
  "dataset",
  "benchmark",
  "term",
  "method",
  "metric",
  "model",
  "architecture",
  "task",
  "library",
  "concept",
] as const;

export function isTypeTag(tag: string): boolean {
  return (TYPE_TAGS as readonly string[]).indexOf(tag) !== -1;
}

/** First type tag in stored order, or null. */
export function firstTypeTag(tags: readonly string[] | null | undefined): string | null {
  for (const tag of tags ?? []) {
    if (isTypeTag(tag)) return tag;
  }
  return null;
}

/**
 * Total order by UTF-16 code unit. Never `localeCompare`: its result depends
 * on the ICU data of the machine, and output must be byte-identical.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rounds and folds -0 into 0. */
export function round(value: number): number {
  return Math.round(value) || 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Rough glyph metrics for Obsidian's default canvas text. */
export const TEXT_METRICS = {
  charPx: 8,
  headingCharPx: 12,
  linePx: 24,
  headingLinePx: 36,
  /** Horizontal padding inside a card, both sides together. */
  chromeX: 40,
  /** Vertical padding inside a card, both sides together. */
  chromeY: 32,
} as const;

function isHeading(line: string): boolean {
  return /^#{1,6} /.test(line);
}

/** Wrapped line count of one source line at `width` px. */
function wrappedLines(line: string, width: number): number {
  const heading = isHeading(line);
  const charPx = heading ? TEXT_METRICS.headingCharPx : TEXT_METRICS.charPx;
  const perLine = Math.max(8, Math.floor((width - TEXT_METRICS.chromeX) / charPx));
  return Math.max(1, Math.ceil(line.length / perLine));
}

/** Estimated height of Markdown `text` rendered at `width` px. */
export function estimateHeight(text: string, width: number): number {
  let total = TEXT_METRICS.chromeY;
  for (const line of text.split("\n")) {
    const n = wrappedLines(line, width);
    total += n * (isHeading(line) ? TEXT_METRICS.headingLinePx : TEXT_METRICS.linePx);
  }
  return round(total);
}

/** Width that fits the longest source line on one row (before clamping). */
export function estimateWidth(text: string): number {
  let widest = 0;
  for (const line of text.split("\n")) {
    const px = line.length * (isHeading(line) ? TEXT_METRICS.headingCharPx : TEXT_METRICS.charPx);
    widest = Math.max(widest, px);
  }
  return round(widest + TEXT_METRICS.chromeX);
}

/**
 * Truncates `text` so it wraps to at most `maxLines` lines at `width`. The
 * first line (the title) is always kept; the cut line ends in "…".
 */
export function truncateToLines(text: string, width: number, maxLines: number): string {
  if (maxLines <= 0) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const n = wrappedLines(line, width);
    if (i === 0 || used + n <= maxLines) {
      out.push(line);
      used += n;
      continue;
    }
    const remaining = maxLines - used;
    if (remaining > 0) {
      const perLine = Math.max(8, Math.floor((width - TEXT_METRICS.chromeX) / TEXT_METRICS.charPx));
      const keep = Math.max(1, remaining * perLine - 1);
      out.push(`${line.slice(0, keep).trimEnd()}…`);
    } else if (out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1].replace(/…$/, "")}…`;
    }
    break;
  }
  return out.join("\n");
}

/** Collapses whitespace runs (including newlines) to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
