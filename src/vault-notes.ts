import { PLUGIN_COPY } from "./copy";
import type { SyncGlossaryTerm, SyncPaper } from "./types";
import { openPdfProtocolUrl } from "./urls";

// eslint-disable-next-line no-control-regex -- Windows rejects control characters in filenames, and paper titles reach us straight from PDF metadata.
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeFilename(raw: string): string {
  let name = raw.replace(WINDOWS_FORBIDDEN, "-").replace(/\s+/g, " ").trim();
  name = name.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  if (!name) {
    name = "untitled";
  }
  if (name.length > 80) {
    name = name.slice(0, 80).trim();
  }
  return name;
}

export function uniqueBasename(
  preferred: string,
  id: string,
  used: Set<string>,
): string {
  const base = sanitizeFilename(preferred).toLowerCase();
  if (!used.has(base)) {
    used.add(base);
    return sanitizeFilename(preferred);
  }
  const withId = sanitizeFilename(`${sanitizeFilename(preferred)}-${id.slice(0, 8)}`);
  const key = withId.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return withId;
  }
  let n = 2;
  while (used.has(`${key}-${n}`)) {
    n += 1;
  }
  const fallback = `${withId}-${n}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

export function yamlScalar(value: string): string {
  if (value === "") {
    return '""';
  }
  if (/[:#{}[\],&*?|!<>=!%@`'\n]/.test(value) || value !== value.trim()) {
    return JSON.stringify(value);
  }
  return value;
}

export function yamlStringArray(values: readonly string[]): string {
  if (values.length === 0) {
    return "[]";
  }
  return `[${values.map((v) => yamlScalar(v)).join(", ")}]`;
}

export function hasPaperSyncMarker(content: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return false;
  }
  return /^paper_sync:\s*true\s*$/m.test(match[1]);
}

function frontmatterBlock(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export function glossaryNoteMarkdown(term: SyncGlossaryTerm): string {
  const tags = Array.isArray(term.tags) ? term.tags : [];
  const rating =
    typeof term.rating === "number" && Number.isFinite(term.rating)
      ? String(term.rating)
      : '""';
  const heading = term.term.trim() || "Untitled term";
  const explanation = term.explanation?.trim() ?? "";
  const open = PLUGIN_COPY.noteGlossaryOpenPdf;
  const protocol = openPdfProtocolUrl(term.paper_id);

  return (
    frontmatterBlock({
      paper_sync: "true",
      source: "paper.college",
      term_id: yamlScalar(term.id),
      paper_id: yamlScalar(term.paper_id),
      tags: yamlStringArray(tags),
      rating,
    }) +
    `\n# ${heading}\n\n` +
    (explanation ? `${explanation}\n\n` : "") +
    `[${open}](${protocol})\n`
  );
}

export function paperStubMarkdown(
  paper: SyncPaper,
  linkedTerms: Array<{ term: string; path: string }>,
): string {
  const title = paper.title.trim() || PLUGIN_COPY.pickerUntitled;
  const open = PLUGIN_COPY.notePaperOpenPdf;
  const protocol = openPdfProtocolUrl(paper.id);
  const links =
    linkedTerms.length === 0
      ? ""
      : `\n${linkedTerms
          .map((item) => `- [[${wikilinkTarget(item.path)}|${item.term}]]`)
          .join("\n")}\n`;

  return (
    frontmatterBlock({
      paper_sync: "true",
      source: "paper.college",
      paper_id: yamlScalar(paper.id),
    }) +
    `\n# ${title}\n\n` +
    `[${open}](${protocol})\n` +
    links
  );
}

export function emptyIndexMarkdown(): string {
  return (
    frontmatterBlock({
      paper_sync: "true",
      source: "paper.college",
    }) + `\n# Glossary\n\n${PLUGIN_COPY.noteFolderEmpty}\n`
  );
}

export function canvasFileContents(mindmap: unknown): string {
  return `${JSON.stringify(mindmap, null, 2)}\n`;
}

function wikilinkTarget(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "");
}

export function joinVaultPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}
