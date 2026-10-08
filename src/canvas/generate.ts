/**
 * Plugin-side JSON Canvas 1.0 generator: builds every `.canvas` file for one
 * library from the raw sync payload and the active preset.
 *
 * Ported from the server's `src/lib/obsidian/canvas.ts`; its three contracts
 * carry over unchanged.
 *
 * PATH CONTRACT
 *   Every path this module emits is relative to the plugin's sync folder,
 *   never to the vault root:
 *     - `GeneratedCanvas.path` — where to write the document;
 *     - every `file` node's `file` — what the node points at.
 *   The writer prefixes its folder to both: it writes `<folder>/<path>` and
 *   rewrites each `file` to `<folder>/<file>` (Obsidian resolves `file` node
 *   paths from the vault root). A canvas written without that rewrite has
 *   dangling links, not broken JSON — it fails quietly.
 *
 * FILENAME AGREEMENT
 *   `Papers/<x>.md` and `Glossary/<x>.md` are named by `sync-apply.ts` with
 *   `uniqueBasename` from `vault-notes.ts`, walking `payload.papers` and
 *   `payload.glossary_terms` in payload order. This module reuses the same
 *   function and walks the same arrays in the same order (consuming a name
 *   even for rows it later drops), so every note `file` node matches. Never
 *   sort either array before naming.
 *
 * DETERMINISM
 *   Identical input ⇒ byte-identical output, or every sync rewrites every
 *   file. No `Math.random`, no `Date.now`, no timestamps in the output,
 *   code-unit string compare (never `localeCompare`), every collection sorted
 *   with a total order (ties broken by id), every coordinate an integer.
 *
 * PAPER CANVAS FOLDERS
 *   With `files.paperFolders === "project"` a paper canvas lives at
 *   `Papers/<Project>/<Paper>.canvas`, where `<Project>` is the same basename
 *   as `Projects/<Project>.canvas`. A paper in several projects gets ONE
 *   canvas, in its primary project: earliest `added_at`, ties by project id
 *   (code-unit). Unfiled papers go under `Papers/Unassigned/`. Only `.canvas`
 *   files move — `.md` notes stay at `Papers/<Paper>.md`.
 *
 * Edges never carry a `label`. Positions come from `layout.ts`, and every
 * canvas goes through the one shared collision pass in `place.ts`.
 */

import {
  CANVAS_COPY,
  canvasCountHighlights,
  canvasCountPapers,
  canvasCountProjects,
  canvasCountTerms,
  canvasHighlightPage,
  canvasMoreLine,
  canvasRatedLine,
  canvasTermInPapers,
  PLUGIN_COPY,
} from "../copy";
import { joinVaultPath, uniqueBasename } from "../vault-notes";
import { layoutTree, type LayoutBlock } from "./layout";
import { withKindMarker } from "./markers";
import { resolvePlacement, type PlacementBox } from "./place";
import {
  clamp,
  compareStrings,
  estimateHeight,
  estimateWidth,
  firstTypeTag,
  oneLine,
  round,
  stripExplainSectionLabels,
  truncateToLines,
} from "./text";
import type {
  CanvasColorValue,
  CanvasDocument,
  CanvasEdge,
  CanvasLevel,
  CanvasNode,
  CanvasNodeKind,
  CanvasPreset,
  CanvasSide,
  CanvasSyncPayload,
  GenerateCanvasesOptions,
  GeneratedCanvas,
  RootKind,
  StyledKind,
} from "./types";

export const DEFAULT_ORIGIN = "https://paper.college";

// --- Folder-relative path vocabulary ------------------------------------------

export const PROJECTS_DIR = "Projects";
export const PAPERS_DIR = "Papers";
export const GLOSSARY_DIR = "Glossary";
export const TERMS_DIR = "Terms";

/** The root canvas per preset root. */
export const OVERVIEW_PATHS: Record<RootKind, string> = {
  library: "Projects.canvas",
  project: "Projects.canvas",
  paper: "Papers.canvas",
  term: "Terms.canvas",
};

/**
 * True for any path this generator can emit (under any preset). Use it to
 * restrict stale-file cleanup to canvas paths the plugin could have written;
 * pair it with a manifest of paths actually written so user canvases that
 * happen to match are never touched.
 */
export function isGeneratedCanvasPath(path: string): boolean {
  if (Object.values(OVERVIEW_PATHS).includes(path)) return true;
  return /^(Projects|Terms)\/[^/]+\.canvas$/.test(path) || /^Papers\/(?:[^/]+\/)?[^/]+\.canvas$/.test(path);
}

/** Group label band: Obsidian draws a group's label just above its box. */
export const GROUP_LABEL_BAND = 40;

// --- Resolved input -------------------------------------------------------------------

interface RPaper {
  id: string;
  title: string;
  basename: string;
  notePath: string;
  canvasPath: string;
  order: number;
  addedFrom: string | null;
  /** Project ids the paper is filed in (known projects only), sorted. */
  projectIds: string[];
}

interface RTermRow {
  id: string;
  term: string;
  normalized: string;
  paperId: string;
  prose: string;
  typeTag: string | null;
  rating: number | null;
  highlightId: string | null;
  createdAt: string;
  notePath: string;
  canvasPath: string;
  order: number;
}

/** One node per `normalized_term`; representative = first row in payload order. */
interface DTerm {
  normalized: string;
  rep: RTermRow;
  paperIds: string[];
  highlightIds: string[];
  createdAt: string;
}

interface RHighlight {
  id: string;
  paperId: string;
  text: string;
  page: number | null;
  createdAt: string;
}

interface RProject {
  /** `null` = the synthetic "Unassigned" bucket. */
  id: string | null;
  name: string;
  basename: string;
  canvasPath: string;
  order: number;
  papers: RPaper[];
}

interface Library {
  papers: RPaper[];
  paperById: Map<string, RPaper>;
  termRows: RTermRow[];
  terms: DTerm[];
  termByNormalized: Map<string, DTerm>;
  highlights: RHighlight[];
  projects: RProject[];
  unassigned: RProject;
  unfiled: RPaper[];
  projectById: Map<string, RProject>;
}

function isRated(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;
}

function resolveLibrary(payload: CanvasSyncPayload, preset: CanvasPreset): Library {
  // Papers: basenames in payload order (sync-apply parity).
  const usedPaper = new Set<string>();
  const papers: RPaper[] = [];
  const paperById = new Map<string, RPaper>();
  (Array.isArray(payload.papers) ? payload.papers : []).forEach((paper, index) => {
    const title = (paper.title ?? "").trim() || PLUGIN_COPY.pickerUntitled;
    const basename = uniqueBasename(title, paper.id ?? "", usedPaper);
    if (!paper.id || paperById.has(paper.id)) return;
    const resolved: RPaper = {
      id: paper.id,
      title,
      basename,
      notePath: joinVaultPath(PAPERS_DIR, `${basename}.md`),
      canvasPath: "",
      order: index,
      addedFrom: paper.added_from_paper_id ?? null,
      projectIds: [],
    };
    papers.push(resolved);
    paperById.set(paper.id, resolved);
  });

  // Terms: basenames in payload order, every row (sync-apply parity).
  const usedTerm = new Set<string>();
  const termRows: RTermRow[] = [];
  (Array.isArray(payload.glossary_terms) ? payload.glossary_terms : []).forEach((row, index) => {
    const basename = uniqueBasename(row.term, row.id, usedTerm);
    if (!row.normalized_term || !paperById.has(row.paper_id)) return;
    const shown = (row.term ?? "").trim() || row.normalized_term;
    termRows.push({
      id: row.id,
      term: shown,
      normalized: row.normalized_term,
      paperId: row.paper_id,
      prose: stripExplainSectionLabels(row.explanation ?? ""),
      typeTag: firstTypeTag(row.tags),
      rating: isRated(row.rating) ? row.rating : null,
      highlightId: row.highlight_id ?? null,
      createdAt: row.created_at ?? "",
      notePath: joinVaultPath(GLOSSARY_DIR, `${basename}.md`),
      canvasPath: joinVaultPath(TERMS_DIR, `${basename}.canvas`),
      order: index,
    });
  });
  const termByNormalized = new Map<string, DTerm>();
  for (const row of termRows) {
    const existing = termByNormalized.get(row.normalized);
    if (!existing) {
      termByNormalized.set(row.normalized, {
        normalized: row.normalized,
        rep: row,
        paperIds: [row.paperId],
        highlightIds: row.highlightId ? [row.highlightId] : [],
        createdAt: row.createdAt,
      });
      continue;
    }
    if (!existing.paperIds.includes(row.paperId)) existing.paperIds.push(row.paperId);
    if (row.highlightId && !existing.highlightIds.includes(row.highlightId)) {
      existing.highlightIds.push(row.highlightId);
    }
    if (compareStrings(row.createdAt, existing.createdAt) > 0) existing.createdAt = row.createdAt;
  }
  const terms = Array.from(termByNormalized.values());
  for (const t of terms) {
    t.paperIds.sort(compareStrings);
    t.highlightIds.sort(compareStrings);
  }

  const highlights: RHighlight[] = [];
  const seenHighlight = new Set<string>();
  for (const h of Array.isArray(payload.highlights) ? payload.highlights : []) {
    if (!h || !h.id || seenHighlight.has(h.id) || !paperById.has(h.paper_id)) continue;
    const text = oneLine(h.selected_text ?? "");
    if (!text) continue;
    seenHighlight.add(h.id);
    highlights.push({
      id: h.id,
      paperId: h.paper_id,
      text,
      page: typeof h.page_number === "number" ? h.page_number : null,
      createdAt: h.created_at ?? "",
    });
  }

  // Projects: "Unassigned" reserves its basename first (server parity).
  const usedProject = new Set<string>();
  const unassignedBase = uniqueBasename(CANVAS_COPY.unassignedProject, "", usedProject);
  const projects: RProject[] = [];
  const projectById = new Map<string, RProject>();
  (Array.isArray(payload.projects) ? payload.projects : []).forEach((project, index) => {
    if (!project || !project.id || projectById.has(project.id)) return;
    const name = (project.name ?? "").trim() || CANVAS_COPY.projectUntitled;
    const basename = uniqueBasename(name, project.id, usedProject);
    const resolved: RProject = {
      id: project.id,
      name,
      basename,
      canvasPath: joinVaultPath(PROJECTS_DIR, `${basename}.canvas`),
      order: index,
      papers: [],
    };
    projects.push(resolved);
    projectById.set(project.id, resolved);
  });

  // Membership + primary project (earliest added_at, ties by project id).
  const primary = new Map<string, { projectId: string; addedAt: string }>();
  const seenMember = new Set<string>();
  for (const row of Array.isArray(payload.project_papers) ? payload.project_papers : []) {
    if (!row) continue;
    const paper = paperById.get(row.paper_id);
    const project = projectById.get(row.project_id);
    if (!paper || !project) continue;
    const key = `${row.project_id}\u0000${row.paper_id}`;
    if (seenMember.has(key)) continue;
    seenMember.add(key);
    project.papers.push(paper);
    paper.projectIds.push(project.id as string);
    const addedAt = row.added_at ?? "";
    const current = primary.get(paper.id);
    if (
      !current ||
      compareStrings(addedAt, current.addedAt) < 0 ||
      (addedAt === current.addedAt && compareStrings(row.project_id, current.projectId) < 0)
    ) {
      primary.set(paper.id, { projectId: row.project_id, addedAt });
    }
  }
  for (const paper of papers) paper.projectIds.sort(compareStrings);

  const unfiled = papers.filter((p) => p.projectIds.length === 0);
  const unassigned: RProject = {
    id: null,
    name: CANVAS_COPY.unassignedProject,
    basename: unassignedBase,
    canvasPath: joinVaultPath(PROJECTS_DIR, `${unassignedBase}.canvas`),
    order: Number.MAX_SAFE_INTEGER,
    papers: unfiled.slice(),
  };

  for (const paper of papers) {
    if (preset.files.paperFolders === "flat") {
      paper.canvasPath = joinVaultPath(PAPERS_DIR, `${paper.basename}.canvas`);
      continue;
    }
    const owner = primary.get(paper.id);
    const folder = owner ? (projectById.get(owner.projectId)?.basename ?? unassignedBase) : unassignedBase;
    paper.canvasPath = joinVaultPath(PAPERS_DIR, folder, `${paper.basename}.canvas`);
  }

  return {
    papers,
    paperById,
    termRows,
    terms,
    termByNormalized,
    highlights,
    projects,
    unassigned,
    unfiled,
    projectById,
  };
}

// --- Sorting ---------------------------------------------------------------------------

function paperRating(lib: Library, paper: RPaper): number {
  let sum = 0;
  let n = 0;
  for (const row of lib.termRows) {
    if (row.paperId === paper.id && row.rating != null) {
      sum += row.rating;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

function paperTermCount(lib: Library, paper: RPaper): number {
  let n = 0;
  for (const t of lib.terms) if (t.paperIds.includes(paper.id)) n += 1;
  return n;
}

function sortPapers(lib: Library, list: RPaper[], preset: CanvasPreset): RPaper[] {
  const alpha = (a: RPaper, b: RPaper): number =>
    compareStrings(a.title.toLowerCase(), b.title.toLowerCase()) || compareStrings(a.id, b.id);
  const sort = preset.grouping.sort;
  return list.slice().sort((a, b) => {
    if (sort === "date") return a.order - b.order || compareStrings(a.id, b.id);
    if (sort === "rating") return paperRating(lib, b) - paperRating(lib, a) || alpha(a, b);
    if (sort === "shared") return paperTermCount(lib, b) - paperTermCount(lib, a) || alpha(a, b);
    return alpha(a, b);
  });
}

function sortProjects(list: RProject[], preset: CanvasPreset): RProject[] {
  const alpha = (a: RProject, b: RProject): number =>
    compareStrings(a.name.toLowerCase(), b.name.toLowerCase()) ||
    compareStrings(a.id ?? "", b.id ?? "");
  const sort = preset.grouping.sort;
  return list.slice().sort((a, b) => {
    if (sort === "date") return a.order - b.order || alpha(a, b);
    if (sort === "shared") return b.papers.length - a.papers.length || alpha(a, b);
    return alpha(a, b);
  });
}

function sortTerms(list: DTerm[], preset: CanvasPreset): DTerm[] {
  const alpha = (a: DTerm, b: DTerm): number =>
    compareStrings(a.normalized, b.normalized) || compareStrings(a.rep.id, b.rep.id);
  const sort = preset.grouping.sort;
  return list.slice().sort((a, b) => {
    if (sort === "date") return compareStrings(b.createdAt, a.createdAt) || alpha(a, b);
    if (sort === "rating") return (b.rep.rating ?? 0) - (a.rep.rating ?? 0) || alpha(a, b);
    if (sort === "shared") return b.paperIds.length - a.paperIds.length || alpha(a, b);
    return alpha(a, b);
  });
}

function sortHighlights(list: RHighlight[], preset: CanvasPreset): RHighlight[] {
  const byPage = (a: RHighlight, b: RHighlight): number =>
    (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER) ||
    compareStrings(a.createdAt, b.createdAt) ||
    compareStrings(a.id, b.id);
  const sort = preset.grouping.sort;
  return list.slice().sort((a, b) => {
    if (sort === "date") return compareStrings(a.createdAt, b.createdAt) || compareStrings(a.id, b.id);
    if (sort === "alpha") return compareStrings(a.text.toLowerCase(), b.text.toLowerCase()) || byPage(a, b);
    return byPage(a, b);
  });
}

// --- Logical canvas model ------------------------------------------------------------------

interface Item {
  id: string;
  kind: CanvasNodeKind;
  /** Kind used for colour / size lookups. */
  styleKind: StyledKind | null;
  level: number;
  type: "text" | "file";
  text?: string;
  file?: string;
  width: number;
  height: number;
  entityId?: string;
  /** Papers a term node appears in (cross links). */
  paperIds?: string[];
  /** Cite provenance of a paper node (cross links). */
  addedFrom?: string | null;
}

interface Group {
  id: string;
  label: string;
  styleKind: StyledKind;
  level: number;
  items: Item[];
  width: number;
  height: number;
  /** Item positions relative to the group's top-left. */
  rel: Array<{ x: number; y: number }>;
}

interface Tree {
  id: string;
  item?: Item;
  group?: Group;
  children: Tree[];
}

/** Per-canvas build state. */
class Canvas {
  private readonly used = new Set<string>();
  readonly up: Item[] = [];

  constructor(
    readonly lib: Library,
    readonly preset: CanvasPreset,
    readonly level: CanvasLevel,
    readonly opts: Required<GenerateCanvasesOptions>,
  ) {}

  uid(base: string): string {
    let id = base;
    let n = 2;
    while (this.used.has(id)) {
      id = `${base}#${n}`;
      n += 1;
    }
    this.used.add(id);
    return id;
  }

  /** Text node sized by the preset's sizing rules. */
  text(kind: CanvasNodeKind, styleKind: StyledKind | null, level: number, raw: string, entityId?: string): Item {
    const size = this.preset.layout.sizes[styleKind ?? "note"];
    const width =
      this.preset.layout.sizing === "fit"
        ? clamp(estimateWidth(raw), size.minWidth, size.maxWidth)
        : size.maxWidth;
    const body = truncateToLines(raw, width, this.preset.layout.maxLines);
    const height = clamp(estimateHeight(body, width), size.minHeight, size.maxHeight);
    return {
      id: this.uid(entityId ? `${kind}:${entityId}` : kind),
      kind,
      styleKind,
      level,
      type: "text",
      text: withKindMarker(body, kind),
      width: round(width),
      height: round(height),
      entityId,
    };
  }

  /** File node; `embed` = a live `.md` note (taller) vs a canvas link. */
  file(kind: CanvasNodeKind, styleKind: StyledKind, level: number, file: string, embed: boolean, entityId?: string): Item {
    const size = this.preset.layout.sizes[styleKind];
    const base = file.slice(file.lastIndexOf("/") + 1);
    const width =
      this.preset.layout.sizing === "fit"
        ? clamp(estimateWidth(`# ${base}`), size.minWidth, size.maxWidth)
        : size.maxWidth;
    return {
      id: this.uid(entityId ? `${kind}:${entityId}` : `${kind}:${file}`),
      kind,
      styleKind,
      level,
      type: "file",
      file,
      width: round(width),
      height: round(embed ? size.maxHeight : size.minHeight),
      entityId,
    };
  }
}

function folderPrefix(opts: Required<GenerateCanvasesOptions>): string {
  const f = opts.folder.trim().replace(/^\/+|\/+$/g, "");
  return f ? `${f}/` : "";
}

function wikilink(opts: Required<GenerateCanvasesOptions>, path: string, alias: string): string {
  return `[[${folderPrefix(opts)}${path.replace(/\.md$/, "")}|${alias}]]`;
}

function paperUrl(opts: Required<GenerateCanvasesOptions>, paperId: string): string {
  return `${opts.origin.replace(/\/+$/, "")}/library/${paperId}`;
}

function libraryUrl(opts: Required<GenerateCanvasesOptions>): string {
  return `${opts.origin.replace(/\/+$/, "")}/library`;
}

function hubLines(c: Canvas, title: string, counts: string, url: string | null): string[] {
  const mode = c.preset.look.hubText;
  const lines = [`# ${title}`];
  if (mode !== "title" && counts) lines.push(counts);
  if (mode === "counts-link" && url) lines.push(`[${CANVAS_COPY.openInPaper}](${url})`);
  return lines;
}

// --- Entity nodes -------------------------------------------------------------------------

function termText(c: Canvas, t: DTerm, full: boolean): string {
  const suffix = t.rep.typeTag ? ` · ${t.rep.typeTag}` : "";
  const lines = [`# ${t.rep.term}${suffix}`];
  if (full || c.preset.look.termText === "definition") {
    if (t.rep.prose) lines.push(t.rep.prose);
    if (t.rep.rating != null) lines.push(canvasRatedLine(t.rep.rating));
  }
  return lines.join("\n");
}

function highlightText(c: Canvas, h: RHighlight): string {
  const quote = `> ${h.text}`;
  if (c.preset.look.highlightText === "text") return quote;
  return [`# ${h.page == null ? CANVAS_COPY.highlightNoPage : canvasHighlightPage(h.page)}`, quote].join("\n");
}

function projectItem(c: Canvas, p: RProject, level: number, link: boolean): Item {
  const key = p.id ?? "unassigned";
  if (link && c.preset.structure.emit.project && projectCanvasEmitted(c.preset, p)) {
    return c.file("project", "project", level, p.canvasPath, false, key);
  }
  const second = p.id === null ? CANVAS_COPY.unassignedHint : canvasCountPapers(p.papers.length);
  return c.text("project", "project", level, `# ${p.name}\n${second}`, key);
}

function paperItem(c: Canvas, p: RPaper, level: number, link: boolean): Item {
  let item: Item;
  if (link && c.preset.structure.emit.paper) {
    item = c.file("paper", "paper", level, p.canvasPath, false, p.id);
  } else if (c.preset.files.paperNode === "file") {
    item = c.file("paper", "paper", level, p.notePath, true, p.id);
  } else {
    const nTerms = paperTermCount(c.lib, p);
    const nHigh = c.lib.highlights.filter((h) => h.paperId === p.id).length;
    item = c.text(
      "paper",
      "paper",
      level,
      `# ${p.title}\n${canvasCountTerms(nTerms)} · ${canvasCountHighlights(nHigh)}`,
      p.id,
    );
  }
  item.addedFrom = p.addedFrom;
  return item;
}

function termItem(c: Canvas, t: DTerm, level: number, link: boolean): Item {
  let item: Item;
  if (link && c.preset.structure.emit.term) {
    item = c.file("term", "term", level, t.rep.canvasPath, false, t.rep.id);
  } else if (c.preset.files.termNode === "file") {
    item = c.file("term", "term", level, t.rep.notePath, true, t.rep.id);
  } else {
    item = c.text("term", "term", level, termText(c, t, false), t.rep.id);
  }
  item.paperIds = t.paperIds;
  return item;
}

function moreItem(c: Canvas, level: number, hidden: number, styleKind: StyledKind, notePath: string | null): Item {
  const line = canvasMoreLine(hidden);
  const text = notePath ? `${line}\n${wikilink(c.opts, notePath, CANVAS_COPY.fullList)}` : line;
  return c.text("more", styleKind, level, text);
}

// --- Groups -------------------------------------------------------------------------------------

function makeGroup(c: Canvas, ownerId: string, key: string, label: string, styleKind: StyledKind, level: number, items: Item[]): Tree {
  const pad = c.preset.layout.groupPadding;
  const gap = Math.max(16, round(c.preset.layout.siblingGap / 2));
  const cols = Math.max(1, c.preset.layout.groupColumns);
  // Proposed grid, then the shared placement pass inside the group.
  const boxes: PlacementBox[] = [];
  let y = 0;
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols);
    let x = 0;
    let rowH = 0;
    for (const item of row) {
      boxes.push({ id: item.id, x, y, width: item.width, height: item.height });
      x += item.width + gap;
      rowH = Math.max(rowH, item.height);
    }
    y += rowH + gap;
  }
  const rel = resolvePlacement(boxes, gap);
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  rel.forEach((p, i) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + items[i].width);
    maxY = Math.max(maxY, p.y + items[i].height);
  });
  const shifted = rel.map((p) => ({ x: p.x - minX + pad, y: p.y - minY + pad }));
  const group: Group = {
    id: c.uid(`group:${ownerId}:${key}`),
    label,
    styleKind,
    level,
    items,
    width: round(maxX - minX + pad * 2),
    height: round(maxY - minY + pad * 2),
    rel: shifted,
  };
  return { id: group.id, group, children: [] };
}

/** Terms, highlights and notes of one paper as cluster groups (or nothing). */
function paperClusters(c: Canvas, paper: RPaper, level: number, ownerId: string): Tree[] {
  const g = c.preset.grouping;
  const terms = sortTerms(
    c.lib.terms.filter((t) => t.paperIds.includes(paper.id)),
    c.preset,
  );
  const highlights = sortHighlights(
    c.lib.highlights.filter((h) => h.paperId === paper.id),
    c.preset,
  );

  const clusters: Array<{ key: string; label: string; kind: StyledKind; items: Item[] }> = [];

  if (g.terms !== "hidden" && terms.length > 0) {
    const shown = g.maxTerms > 0 ? terms.slice(0, g.maxTerms) : terms;
    const items = shown.map((t) => termItem(c, t, level, true));
    if (shown.length < terms.length) {
      items.push(moreItem(c, level, terms.length - shown.length, "term", paper.notePath));
    }
    clusters.push({ key: "terms", label: CANVAS_COPY.groupTerms, kind: "term", items });
  }
  if (g.highlights !== "hidden" && highlights.length > 0) {
    const shown = g.maxHighlights > 0 ? highlights.slice(0, g.maxHighlights) : highlights;
    const items = shown.map((h) => c.text("highlight", "highlight", level, highlightText(c, h), h.id));
    if (shown.length < highlights.length) {
      items.push(moreItem(c, level, highlights.length - shown.length, "highlight", paper.notePath));
    }
    clusters.push({ key: "highlights", label: CANVAS_COPY.groupHighlights, kind: "highlight", items });
  }
  if (g.notes !== "hidden" && c.preset.files.noteNodes[c.level]) {
    const items: Item[] = [c.file("note", "note", level, paper.notePath, false, `paper:${paper.id}`)];
    if (g.terms !== "hidden" && c.preset.files.termNode !== "file") {
      const shown = g.maxTerms > 0 ? terms.slice(0, g.maxTerms) : terms;
      for (const t of shown) items.push(c.file("note", "note", level, t.rep.notePath, false, `term:${t.rep.id}`));
    }
    clusters.push({ key: "notes", label: CANVAS_COPY.groupNotes, kind: "note", items });
  }

  const separate = clusters.filter((cl) => (cl.key === "terms" ? g.terms : cl.key === "highlights" ? g.highlights : g.notes) === "separate");
  const merged = clusters.filter((cl) => !separate.includes(cl));
  const out: Tree[] = separate.map((cl) => makeGroup(c, ownerId, cl.key, cl.label, cl.kind, level, cl.items));
  if (merged.length > 0) {
    out.push(
      makeGroup(
        c,
        ownerId,
        "merged",
        CANVAS_COPY.groupMerged,
        merged[0].kind,
        level,
        merged.flatMap((cl) => cl.items),
      ),
    );
  }
  return out;
}

function projectTermsGroup(c: Canvas, project: RProject, level: number, ownerId: string): Tree | null {
  const g = c.preset.grouping;
  if (g.projectTerms === "none" || g.terms === "hidden") return null;
  const ids = new Set(project.papers.map((p) => p.id));
  let terms = c.lib.terms.filter((t) => t.paperIds.some((id) => ids.has(id)));
  if (g.projectTerms === "shared") {
    terms = terms.filter((t) => t.paperIds.filter((id) => ids.has(id)).length >= 2);
  }
  if (terms.length === 0) return null;
  const sorted = sortTerms(terms, c.preset);
  const shown = g.maxTerms > 0 ? sorted.slice(0, g.maxTerms) : sorted;
  const items = shown.map((t) => termItem(c, t, level, true));
  if (shown.length < sorted.length) items.push(moreItem(c, level, sorted.length - shown.length, "term", null));
  return makeGroup(c, ownerId, "project-terms", CANVAS_COPY.groupProjectTerms, "term", level, items);
}

function leaf(item: Item): Tree {
  return { id: item.id, item, children: [] };
}

// --- Per-canvas tree builders -----------------------------------------------------------------

function emptyChild(c: Canvas, text: string): Tree {
  return leaf(c.text("empty", null, 1, text));
}

function projectCanvasEmitted(preset: CanvasPreset, p: RProject): boolean {
  return p.id !== null || preset.structure.unassigned === "bucket";
}

/** Projects shown under a library/project root, honouring the unassigned mode. */
function rootProjects(c: Canvas): RProject[] {
  const list = sortProjects(c.lib.projects, c.preset);
  if (c.preset.structure.unassigned === "bucket" && c.lib.unfiled.length > 0) list.push(c.lib.unassigned);
  return list;
}

function papersUnder(c: Canvas, papers: RPaper[], level: number, inline: boolean): Tree[] {
  return sortPapers(c.lib, papers, c.preset).map((paper) => {
    const item = paperItem(c, paper, level, !inline);
    const node = leaf(item);
    if (inline) node.children = paperClusters(c, paper, level + 1, item.id);
    return node;
  });
}

function buildOverview(c: Canvas): Tree {
  const s = c.preset.structure;
  const lib = c.lib;
  const inline = s.depth === 2;

  if (s.root === "library" || s.root === "project") {
    const projects = rootProjects(c);
    const named = lib.projects.length;
    const hubText =
      s.root === "library"
        ? hubLines(c, CANVAS_COPY.libraryHub, `${canvasCountProjects(named)} · ${canvasCountPapers(lib.papers.length)}`, libraryUrl(c.opts))
        : hubLines(c, CANVAS_COPY.projectsHub, canvasCountProjects(named), libraryUrl(c.opts));
    const hub = c.text("hub", "hub", 0, hubText.join("\n"), "root");
    const root: Tree = leaf(hub);
    // Library depth 2 inlines papers under each project; project root keeps
    // the overview an index (its depth applies to project canvases).
    const inlinePapers = s.root === "library" && inline;
    for (const project of projects) {
      const item = projectItem(c, project, 1, !inlinePapers);
      const node = leaf(item);
      if (inlinePapers) node.children = papersUnder(c, project.papers, 2, false);
      root.children.push(node);
    }
    if (s.unassigned === "root") root.children.push(...papersUnder(c, lib.unfiled, 1, false));
    if (root.children.length === 0) root.children.push(emptyChild(c, CANVAS_COPY.emptyLibrary));
    return root;
  }

  if (s.root === "paper") {
    const hub = c.text(
      "hub",
      "hub",
      0,
      hubLines(c, CANVAS_COPY.papersHub, canvasCountPapers(lib.papers.length), libraryUrl(c.opts)).join("\n"),
      "root",
    );
    const root = leaf(hub);
    const papers = s.unassigned === "hidden" ? lib.papers.filter((p) => p.projectIds.length > 0) : lib.papers;
    root.children = papersUnder(c, papers, 1, inline);
    if (root.children.length === 0) root.children.push(emptyChild(c, CANVAS_COPY.emptyLibrary));
    return root;
  }

  // term root
  const hub = c.text(
    "hub",
    "hub",
    0,
    hubLines(c, CANVAS_COPY.termsHub, canvasCountTerms(lib.terms.length), libraryUrl(c.opts)).join("\n"),
    "root",
  );
  const root = leaf(hub);
  const sorted = sortTerms(lib.terms, c.preset);
  const cap = c.preset.grouping.maxTerms;
  const shown = cap > 0 ? sorted.slice(0, cap) : sorted;
  for (const t of shown) {
    const item = termItem(c, t, 1, !inline);
    const node = leaf(item);
    if (inline) {
      const papers = t.paperIds.map((id) => lib.paperById.get(id)).filter((p): p is RPaper => Boolean(p));
      node.children = sortPapers(lib, papers, c.preset).map((p) => leaf(paperItem(c, p, 2, true)));
    }
    root.children.push(node);
  }
  if (shown.length < sorted.length) root.children.push(leaf(moreItem(c, 1, sorted.length - shown.length, "term", null)));
  if (root.children.length === 0) root.children.push(emptyChild(c, CANVAS_COPY.emptyTerms));
  return root;
}

function buildProjectCanvas(c: Canvas, project: RProject): Tree {
  const s = c.preset.structure;
  const key = project.id ?? "unassigned";
  const counts = project.id === null ? CANVAS_COPY.unassignedHint : canvasCountPapers(project.papers.length);
  const hub = c.text("hub", "hub", 0, hubLines(c, project.name, counts, libraryUrl(c.opts)).join("\n"), `project:${key}`);
  const root = leaf(hub);
  const inline = s.root === "project" && s.depth === 2;
  root.children = papersUnder(c, project.papers, 1, inline);
  const terms = projectTermsGroup(c, project, 1, hub.id);
  if (terms) root.children.push(terms);
  if (root.children.length === 0) root.children.push(emptyChild(c, CANVAS_COPY.emptyProject));
  if (c.preset.files.backlinkToParent && s.emit.overview) {
    c.up.push(c.file("up", "note", 0, OVERVIEW_PATHS[s.root], false, "overview"));
  }
  return root;
}

function buildPaperCanvas(c: Canvas, paper: RPaper): Tree {
  const s = c.preset.structure;
  const lib = c.lib;
  const nTerms = paperTermCount(lib, paper);
  const nHigh = lib.highlights.filter((h) => h.paperId === paper.id).length;
  const hub = c.text(
    "hub",
    "hub",
    0,
    hubLines(c, paper.title, `${canvasCountTerms(nTerms)} · ${canvasCountHighlights(nHigh)}`, paperUrl(c.opts, paper.id)).join("\n"),
    `paper:${paper.id}`,
  );
  const root = leaf(hub);
  root.children = paperClusters(c, paper, 1, hub.id);
  if (c.preset.connections.backlinks && paper.addedFrom) {
    const source = lib.paperById.get(paper.addedFrom);
    if (source && source.id !== paper.id) root.children.push(leaf(paperItem(c, source, 1, true)));
  }
  if (root.children.length === 0) root.children.push(emptyChild(c, CANVAS_COPY.emptyPaper));

  if (c.preset.files.backlinkToParent) {
    const viaProjects = (s.root === "library" || s.root === "project") && s.emit.project && !(s.root === "library" && s.depth === 2);
    let added = false;
    if (viaProjects) {
      const owners = paper.projectIds
        .map((id) => lib.projectById.get(id))
        .filter((p): p is RProject => Boolean(p));
      if (owners.length === 0 && s.unassigned === "bucket") owners.push(lib.unassigned);
      for (const owner of sortProjects(owners, c.preset)) {
        c.up.push(c.file("up", "note", 0, owner.canvasPath, false, `project:${owner.id ?? "unassigned"}`));
        added = true;
      }
    }
    if (!added && s.emit.overview) c.up.push(c.file("up", "note", 0, OVERVIEW_PATHS[s.root], false, "overview"));
  }
  return root;
}

function buildTermCanvas(c: Canvas, term: DTerm): Tree {
  const s = c.preset.structure;
  const lib = c.lib;
  const lines = hubLines(c, `${term.rep.term}${term.rep.typeTag ? ` · ${term.rep.typeTag}` : ""}`, canvasTermInPapers(term.paperIds.length), term.paperIds.length > 0 ? paperUrl(c.opts, term.paperIds[0]) : null);
  const full = termText(c, term, true).split("\n").slice(1);
  const hub = c.text("hub", "hub", 0, [...lines, ...full].join("\n"), `term:${term.rep.id}`);
  const root = leaf(hub);
  const papers = term.paperIds.map((id) => lib.paperById.get(id)).filter((p): p is RPaper => Boolean(p));
  root.children = sortPapers(lib, papers, c.preset).map((p) => leaf(paperItem(c, p, 1, true)));
  const g = c.preset.grouping;
  if (g.highlights !== "hidden") {
    const hs = sortHighlights(lib.highlights.filter((h) => term.highlightIds.includes(h.id)), c.preset);
    const shown = g.maxHighlights > 0 ? hs.slice(0, g.maxHighlights) : hs;
    if (shown.length > 0) {
      const items = shown.map((h) => c.text("highlight", "highlight", 1, highlightText(c, h), h.id));
      if (shown.length < hs.length) items.push(moreItem(c, 1, hs.length - shown.length, "highlight", null));
      root.children.push(makeGroup(c, hub.id, "highlights", CANVAS_COPY.groupHighlights, "highlight", 1, items));
    }
  }
  if (g.notes !== "hidden" && c.preset.files.noteNodes.term) {
    const note = c.file("note", "note", 1, term.rep.notePath, false, `term:${term.rep.id}`);
    root.children.push(makeGroup(c, hub.id, "notes", CANVAS_COPY.groupNotes, "note", 1, [note]));
  }
  if (c.preset.files.backlinkToParent && s.emit.overview) {
    c.up.push(c.file("up", "note", 0, OVERVIEW_PATHS[s.root], false, "overview"));
  }
  return root;
}

// --- Tree → JSON Canvas ----------------------------------------------------------------------------

function toBlock(tree: Tree): LayoutBlock {
  const size = tree.group ?? tree.item;
  return {
    id: tree.id,
    width: size ? size.width : 0,
    height: size ? size.height : 0,
    padTop: tree.group ? GROUP_LABEL_BAND : 0,
    children: tree.children.map(toBlock),
  };
}

function colorFor(c: Canvas, styleKind: StyledKind | null, level: number): CanvasColorValue | undefined {
  const look = c.preset.look;
  if (look.colorMode === "plain") return undefined;
  if (look.colorMode === "level") return look.levelColors[Math.min(level, look.levelColors.length - 1)];
  return styleKind ? look.kindColors[styleKind] : undefined;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function nearestSides(a: Rect, b: Rect): [CanvasSide, CanvasSide] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function flowSides(c: Canvas, a: Rect, b: Rect): [CanvasSide, CanvasSide] {
  const algo = c.preset.layout.algorithm;
  if (c.preset.connections.sides === "nearest" || algo === "radial" || algo === "grid") return nearestSides(a, b);
  if (algo === "tree-LR") {
    return b.x >= a.x + a.width ? ["right", "left"] : nearestSides(a, b);
  }
  return b.y >= a.y + a.height ? ["bottom", "top"] : nearestSides(a, b);
}

function render(c: Canvas, root: Tree): CanvasDocument {
  const p = c.preset;
  const block = toBlock(root);
  const desired = layoutTree(block, p.layout.algorithm, {
    siblingGap: p.layout.siblingGap,
    levelGap: p.layout.levelGap,
    gridColumns: p.layout.gridColumns,
  });

  // Priority order: breadth-first from the hub, then back-links.
  const order: Tree[] = [];
  const queue: Tree[] = [root];
  for (let i = 0; i < queue.length; i += 1) {
    order.push(queue[i]);
    queue.push(...queue[i].children);
  }
  const boxes: PlacementBox[] = order.map((t) => {
    const at = desired.get(t.id) ?? { x: 0, y: 0 };
    const size = t.group ?? t.item;
    return {
      id: t.id,
      x: at.x,
      y: at.y,
      width: size ? size.width : 0,
      height: size ? size.height : 0,
      padTop: t.group ? GROUP_LABEL_BAND : 0,
    };
  });

  // Back-links: a row centred above everything the layout proposed.
  if (c.up.length > 0) {
    const hubAt = desired.get(root.id) ?? { x: 0, y: 0 };
    const hubW = root.item ? root.item.width : 0;
    let top = Number.POSITIVE_INFINITY;
    for (const b of boxes) top = Math.min(top, b.y - (b.padTop ?? 0));
    const gap = p.layout.siblingGap;
    const rowW = c.up.reduce((sum, u, i) => sum + u.width + (i > 0 ? gap : 0), 0);
    const rowH = Math.max(...c.up.map((u) => u.height));
    let x = hubAt.x + hubW / 2 - rowW / 2;
    for (const u of c.up) {
      boxes.splice(1 + c.up.indexOf(u), 0, {
        id: u.id,
        x,
        y: top - p.layout.levelGap - rowH,
        width: u.width,
        height: u.height,
      });
      x += u.width + gap;
    }
  }

  const margin = Math.max(24, Math.min(p.layout.siblingGap, p.layout.levelGap));
  const placed = resolvePlacement(boxes, margin);
  const pos = new Map<string, { x: number; y: number }>();
  boxes.forEach((b, i) => pos.set(b.id, placed[i]));

  const groups: CanvasNode[] = [];
  const nodes: CanvasNode[] = [];
  const rects = new Map<string, Rect>();
  const kindOf = new Map<string, { styleKind: StyledKind | null; level: number }>();

  const emitItem = (item: Item, x: number, y: number): void => {
    const color = colorFor(c, item.styleKind, item.level);
    const base = {
      id: item.id,
      x: round(x),
      y: round(y),
      width: item.width,
      height: item.height,
      ...(color ? { color } : {}),
      paperCollege: item.entityId ? { kind: item.kind, entityId: item.entityId } : { kind: item.kind },
    };
    const node: CanvasNode =
      item.type === "file"
        ? { ...base, type: "file", file: item.file ?? "" }
        : { ...base, type: "text", text: item.text ?? "" };
    nodes.push(node);
    rects.set(item.id, { x: node.x, y: node.y, width: node.width, height: node.height });
    kindOf.set(item.id, { styleKind: item.styleKind, level: item.level });
  };

  const upIds = new Set(c.up.map((u) => u.id));
  for (const b of boxes) {
    if (!upIds.has(b.id)) continue;
    const u = c.up.find((x) => x.id === b.id);
    const at = pos.get(b.id);
    if (u && at) emitItem(u, at.x, at.y);
  }
  for (const t of order) {
    const at = pos.get(t.id) ?? { x: 0, y: 0 };
    if (t.item) emitItem(t.item, at.x, at.y);
    if (t.group) {
      const g = t.group;
      const color = colorFor(c, g.styleKind, g.level);
      groups.push({
        id: g.id,
        type: "group",
        x: at.x,
        y: at.y,
        width: g.width,
        height: g.height,
        label: g.label,
        ...(color ? { color } : {}),
        paperCollege: { kind: "group" },
      });
      rects.set(g.id, { x: at.x, y: at.y, width: g.width, height: g.height });
      kindOf.set(g.id, { styleKind: g.styleKind, level: g.level });
      g.items.forEach((item, i) => emitItem(item, at.x + g.rel[i].x, at.y + g.rel[i].y));
    }
  }

  // --- Edges (never labelled) ---
  const edges: CanvasEdge[] = [];
  const seen = new Set<string>();
  const connect = (from: string, to: string, kind: "tree" | "other"): void => {
    if (from === to) return;
    const a = rects.get(from);
    const b = rects.get(to);
    if (!a || !b) return;
    const id = `edge:${from}->${to}`;
    if (seen.has(id) || seen.has(`edge:${to}->${from}`)) return;
    seen.add(id);
    const [fromSide, toSide] = kind === "tree" ? flowSides(c, a, b) : nearestSides(a, b);
    const target = kindOf.get(to);
    const color = target ? colorFor(c, target.styleKind, target.level) : undefined;
    edges.push({
      id,
      fromNode: from,
      toNode: to,
      fromSide,
      toSide,
      fromEnd: "none",
      toEnd: p.connections.arrow === "end" ? "arrow" : "none",
      ...(color ? { color } : {}),
    });
  };

  for (const t of order) {
    for (const child of t.children) connect(t.id, child.id, "tree");
  }
  if (p.connections.siblings) {
    for (const t of order) {
      for (let i = 1; i < t.children.length; i += 1) connect(t.children[i - 1].id, t.children[i].id, "other");
    }
  }
  if (p.connections.backlinks) {
    const allItems: Item[] = [];
    for (const t of order) {
      if (t.item) allItems.push(t.item);
      if (t.group) allItems.push(...t.group.items);
    }
    const paperNodes = new Map<string, string[]>();
    for (const item of allItems) {
      if (item.kind === "paper" && item.entityId) {
        const list = paperNodes.get(item.entityId) ?? [];
        list.push(item.id);
        paperNodes.set(item.entityId, list);
      }
    }
    for (const item of allItems) {
      if (item.kind === "term" && item.paperIds) {
        for (const pid of item.paperIds) for (const target of paperNodes.get(pid) ?? []) connect(item.id, target, "other");
      }
      if (item.kind === "paper" && item.addedFrom) {
        for (const target of paperNodes.get(item.addedFrom) ?? []) connect(item.id, target, "other");
      }
    }
  }

  return {
    nodes: [...groups, ...nodes],
    edges,
    paperCollege: { canvas: c.level, presetId: p.id, schemaVersion: 3, source: "paper.college" },
  };
}

// --- Public API -------------------------------------------------------------------------------------

/**
 * Builds every `.canvas` file for the library under `preset`.
 *
 * @returns Files in a fixed order — overview, project canvases, paper
 *   canvases, term canvases — each `path` sync-folder relative.
 */
export function generateCanvases(
  payload: CanvasSyncPayload,
  preset: CanvasPreset,
  options: GenerateCanvasesOptions = {},
): GeneratedCanvas[] {
  const opts: Required<GenerateCanvasesOptions> = {
    origin: options.origin ?? DEFAULT_ORIGIN,
    folder: options.folder ?? "",
  };
  const lib = resolveLibrary(payload, preset);
  const s = preset.structure;
  const out: GeneratedCanvas[] = [];
  const make = (level: CanvasLevel): Canvas => new Canvas(lib, preset, level, opts);

  if (s.emit.overview) {
    const c = make("overview");
    out.push({ path: OVERVIEW_PATHS[s.root], document: render(c, buildOverview(c)) });
  }

  if (s.emit.project && (s.root === "library" || s.root === "project")) {
    const projects = rootProjects(make("project"));
    for (const project of projects) {
      if (!projectCanvasEmitted(preset, project)) continue;
      const c = make("project");
      out.push({ path: project.canvasPath, document: render(c, buildProjectCanvas(c, project)) });
    }
  }

  if (s.emit.paper) {
    for (const paper of sortPapers(lib, lib.papers, preset)) {
      const c = make("paper");
      out.push({ path: paper.canvasPath, document: render(c, buildPaperCanvas(c, paper)) });
    }
  }

  if (s.emit.term) {
    for (const term of sortTerms(lib.terms, preset)) {
      const c = make("term");
      out.push({ path: term.rep.canvasPath, document: render(c, buildTermCanvas(c, term)) });
    }
  }

  return out;
}

/** The paths `generateCanvases` would write, in the same order. */
export function generatedCanvasPaths(canvases: readonly GeneratedCanvas[]): string[] {
  return canvases.map((entry) => entry.path);
}

/** `JSON.stringify` form the writer should use (stable, trailing newline). */
export function serializeCanvas(document: CanvasDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
