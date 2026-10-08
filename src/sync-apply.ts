import { findPdfHazards, isAllowedVaultPath, isJsonCanvas } from "./payload-guard";
import {
  emptyIndexMarkdown,
  glossaryNoteMarkdown,
  hasPaperSyncMarker,
  joinVaultPath,
  paperStubMarkdown,
  uniqueBasename,
} from "./vault-notes";

import type {
  ApplyPlan,
  ApplyResult,
  CanvasManifest,
  PlacedFigure,
  PlannedWrite,
  SyncGlossaryTerm,
  SyncPaper,
  SyncPayload,
} from "./types";
import { PLUGIN_COPY } from "./copy";
import {
  generateCanvases,
  isGeneratedCanvasPath,
  OVERVIEW_PATHS,
  serializeCanvas,
  TERMS_DIR,
} from "./canvas/generate";
import { shippedPreset, DEFAULT_PRESET_ID, SHIPPED_PRESETS, clonePreset } from "./canvas/presets";
import type {
  CanvasDocument,
  CanvasPreset,
  CanvasSyncPayload,
  GeneratedCanvas,
} from "./canvas/types";

export { joinVaultPath };

export const GLOSSARY_DIR = "Glossary";
export const PAPERS_DIR = "Papers";
export const PROJECTS_DIR = "Projects";
export const LEGACY_CANVAS_FILENAME = "Mindmap.canvas";
export const EMPTY_INDEX_FILENAME = "Glossary.md";

export interface VaultWriter {
  exists(path: string): Promise<boolean>;
  isFile(path: string): Promise<boolean>;
  isFolder(path: string): Promise<boolean>;
  read(path: string): Promise<string | null>;
  writeAtomic(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  /** Full paths of a folder's direct children, or null if it is not a folder. */
  children(path: string): Promise<string[] | null>;
  /** Removes a file or an (empty) folder. */
  remove(path: string): Promise<void>;
}

export type BuildPlanOptions = {
  /** Preset to generate canvases with. Default: shipped preset #1. */
  preset?: CanvasPreset;
  /**
   * Origin for paper.college links inside canvases and for the "open page in
   * Paper" links in a paper note's Figures section.
   */
  origin?: string;
  /**
   * Figure images present in the vault after the figure pass (see
   * `syncFigures`), embedded in each paper note's "## Figures" section.
   */
  figures?: PlacedFigure[];
};

export type ApplyOptions = {
  /** Canvases written by the previous sync (stale-cleanup candidates). */
  manifest?: CanvasManifest | null;
};

function defaultPreset(): CanvasPreset {
  return clonePreset(shippedPreset(DEFAULT_PRESET_ID) ?? SHIPPED_PRESETS[0]);
}

/**
 * Pure: the canvases a sync would write for `payload` under `preset`, with
 * sync-folder-relative paths and `file` nodes (the generator's contract). The
 * settings preview calls this on the cached payload — no vault, no network.
 */
export function previewCanvases(
  payload: CanvasSyncPayload | null,
  preset: CanvasPreset,
  opts: { folder?: string; origin?: string } = {},
): GeneratedCanvas[] {
  const source: CanvasSyncPayload = payload ?? { papers: [] };
  return generateCanvases(source, preset, {
    folder: normalizeFolderName(opts.folder ?? ""),
    origin: opts.origin,
  });
}

/**
 * True when `content` is a file this plugin wrote: a note with
 * `paper_sync: true` frontmatter, or a canvas whose document-level
 * `paperCollege.source` is `paper.college` (both the server-era canvases and
 * the locally generated ones carry it).
 */
export function isPluginOwnedContent(path: string, content: string): boolean {
  if (!path.toLowerCase().endsWith(".canvas")) {
    return hasPaperSyncMarker(content);
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return false;
    }
    const meta = (parsed as Record<string, unknown>).paperCollege;
    return (
      !!meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).source === "paper.college"
    );
  } catch {
    return false;
  }
}

export function normalizeFolderName(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? trimmed : PLUGIN_COPY.folderDefault;
}

export function buildApplyPlan(
  payload: SyncPayload,
  folderRaw: string,
  options: BuildPlanOptions = {},
): ApplyPlan {
  const folder = normalizeFolderName(folderRaw);
  const hazards = findPdfHazards(payload);
  const abortReasons = hazards.map((h) => h.reason);
  const glossaryAborted = hazards.some((h) => h.part === "glossary");
  const papersAborted = hazards.some((h) => h.part === "papers");
  // Canvas text is prose: only real hazards (see `findPdfHazards`) block it.
  const canvasAborted = hazards.some((h) => h.part === "canvas");

  const writes: PlannedWrite[] = [];
  const terms = Array.isArray(payload.glossary_terms) ? payload.glossary_terms : [];
  const papers = Array.isArray(payload.papers) ? payload.papers : [];
  const emptyGlossary = terms.length === 0;
  const usedTermNames = new Set<string>();
  const usedPaperNames = new Set<string>();
  const termPaths = new Map<string, { term: string; path: string }>();

  if (!glossaryAborted) {
    for (const term of terms) {
      const write = planGlossaryWrite(folder, term, usedTermNames);
      if (write) {
        writes.push(write);
        termPaths.set(term.id, {
          term: term.term,
          path: write.relativePath,
        });
      }
    }
    if (emptyGlossary) {
      const indexPath = joinVaultPath(folder, EMPTY_INDEX_FILENAME);
      if (isAllowedVaultPath(indexPath)) {
        writes.push({
          relativePath: indexPath,
          content: emptyIndexMarkdown(),
          kind: "index",
        });
      }
    }
  }

  if (!papersAborted) {
    const termsByPaper = groupTermsByPaper(terms);
    const figuresByPaper = new Map<string, PlacedFigure[]>();
    for (const placed of options.figures ?? []) {
      const list = figuresByPaper.get(placed.figure.paper_id) ?? [];
      list.push(placed);
      figuresByPaper.set(placed.figure.paper_id, list);
    }
    for (const paper of papers) {
      const linked = (termsByPaper.get(paper.id) ?? [])
        .map((term) => termPaths.get(term.id))
        .filter((item): item is { term: string; path: string } => Boolean(item));
      const write = planPaperWrite(
        folder,
        paper,
        linked,
        usedPaperNames,
        figuresByPaper.get(paper.id) ?? [],
        options.origin,
      );
      if (write) {
        writes.push(write);
      }
    }
  }

  const canvasPaths: string[] = [];
  if (!canvasAborted) {
    // `payload.canvases` (legacy, server-built) is ignored on purpose.
    const generated = previewCanvases(payload, options.preset ?? defaultPreset(), {
      folder,
      origin: options.origin,
    });
    for (const entry of generated) {
      const canvasPath = joinVaultPath(folder, entry.path);
      if (!isAllowedVaultPath(canvasPath) || !isJsonCanvas(entry.document)) {
        abortReasons.push(`canvas ${entry.path} is not valid`);
        continue;
      }
      canvasPaths.push(entry.path);
      writes.push({
        relativePath: canvasPath,
        content: serializeCanvas(rewriteFileNodePaths(entry.document, folder)),
        kind: "canvas",
      });
    }
  }

  return {
    writes: writes.filter((w) => isAllowedVaultPath(w.relativePath)),
    folder,
    glossaryAborted,
    canvasAborted,
    papersAborted,
    abortReasons,
    termCount: terms.length,
    paperCount: papers.length,
    emptyGlossary,
    canvasPaths,
  };
}

/** Generator paths are sync-folder relative; Obsidian resolves `file` from the vault root. */
export function rewriteFileNodePaths(document: CanvasDocument, folder: string): CanvasDocument {
  const nodes = document.nodes.map((node) =>
    node.type === "file" ? { ...node, file: `${folder}/${node.file}` } : node,
  );
  return { ...document, nodes };
}

function planGlossaryWrite(
  folder: string,
  term: SyncGlossaryTerm,
  used: Set<string>,
): PlannedWrite | null {
  const basename = uniqueBasename(term.term, term.id, used);
  const relativePath = joinVaultPath(folder, GLOSSARY_DIR, `${basename}.md`);
  if (!isAllowedVaultPath(relativePath)) {
    return null;
  }
  return {
    relativePath,
    content: glossaryNoteMarkdown(term),
    kind: "glossary",
  };
}

function planPaperWrite(
  folder: string,
  paper: SyncPaper,
  linked: Array<{ term: string; path: string }>,
  used: Set<string>,
  figures: PlacedFigure[],
  baseUrl: string | undefined,
): PlannedWrite | null {
  const title = paper.title?.trim() || PLUGIN_COPY.pickerUntitled;
  const basename = uniqueBasename(title, paper.id, used);
  const relativePath = joinVaultPath(folder, PAPERS_DIR, `${basename}.md`);
  if (!isAllowedVaultPath(relativePath)) {
    return null;
  }
  return {
    relativePath,
    content: paperStubMarkdown(paper, linked, figures, baseUrl),
    kind: "paper",
  };
}

function groupTermsByPaper(
  terms: SyncGlossaryTerm[],
): Map<string, SyncGlossaryTerm[]> {
  const map = new Map<string, SyncGlossaryTerm[]>();
  for (const term of terms) {
    const list = map.get(term.paper_id) ?? [];
    list.push(term);
    map.set(term.paper_id, list);
  }
  return map;
}

export async function applyPlan(
  vault: VaultWriter,
  plan: ApplyPlan,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const result: ApplyResult = {
    written: [],
    skippedUser: [],
    failed: [],
    removed: [],
    folderError: null,
    glossaryOk: !plan.glossaryAborted,
    canvasOk: !plan.canvasAborted,
    papersOk: !plan.papersAborted,
    canvasManifest: null,
  };

  try {
    await ensureFolderTree(vault, plan.folder);
    // Prune the legacy Mindmap.canvas if it was plugin-owned
    const legacyPath = joinVaultPath(plan.folder, LEGACY_CANVAS_FILENAME);
    const legacyContent = await vault.read(legacyPath);
    if (
      legacyContent !== null &&
      legacyContent !== "" &&
      (hasPaperSyncMarker(legacyContent) ||
        isPluginOwnedContent(legacyPath, legacyContent))
    ) {
      await vault.writeAtomic(legacyPath, "");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : PLUGIN_COPY.folderError;
    result.folderError = message;
    result.glossaryOk = false;
    result.canvasOk = false;
    result.papersOk = false;
    return result;
  }

  for (const write of plan.writes) {
    if (!isAllowedVaultPath(write.relativePath)) {
      result.failed.push(write.relativePath);
      markKindFailed(result, write.kind);
      continue;
    }
    const existing = await vault.read(write.relativePath);
    if (existing !== null && !isPluginOwnedContent(write.relativePath, existing)) {
      result.skippedUser.push(write.relativePath);
      continue;
    }
    try {
      await ensureParentFolder(vault, write.relativePath);
      await vault.writeAtomic(write.relativePath, write.content);
      result.written.push(write.relativePath);
    } catch {
      result.failed.push(write.relativePath);
      markKindFailed(result, write.kind);
    }
  }

  if (!plan.canvasAborted) {
    result.canvasManifest = await cleanupStaleCanvases(vault, plan, result, options.manifest ?? null);
  }

  if (plan.glossaryAborted) {
    result.glossaryOk = false;
  }
  if (plan.canvasAborted) {
    result.canvasOk = false;
  }
  if (plan.papersAborted) {
    result.papersOk = false;
  }

  return result;
}

/**
 * Removes canvases the plugin wrote before but this sync no longer generates
 * (preset switch, a paper whose primary project changed, a deleted paper),
 * then any subfolder that leaves empty. A path is removed only when it is
 *   - a previous-sync candidate: in the manifest, or — on the first sync with
 *     a manifest (upgrade from the server-built canvases) — an existing
 *     canvas under the sync folder;
 *   - a path the generator can emit (`isGeneratedCanvasPath`);
 *   - plugin-owned by content (`isPluginOwnedContent`).
 * Returns the manifest to persist: every generated canvas now on disk plus
 * stale ones that could not be removed (retried next sync).
 */
async function cleanupStaleCanvases(
  vault: VaultWriter,
  plan: ApplyPlan,
  result: ApplyResult,
  manifest: CanvasManifest | null,
): Promise<CanvasManifest> {
  const folder = plan.folder;
  const current = new Set(plan.canvasPaths);
  const written = new Set(result.written);
  const keep = new Set<string>();
  const previous = manifest && manifest.folder === folder ? manifest.paths : null;

  for (const path of plan.canvasPaths) {
    const full = joinVaultPath(folder, path);
    if (written.has(full) || (previous?.includes(path) && result.failed.includes(full))) {
      keep.add(path);
    }
  }

  const candidates = new Set<string>(previous ?? (await existingCanvasPaths(vault, folder)));
  const emptiedParents = new Set<string>();
  for (const path of Array.from(candidates).sort(compareCodeUnits)) {
    if (current.has(path) || !isGeneratedCanvasPath(path)) {
      continue;
    }
    const full = joinVaultPath(folder, path);
    const content = await vault.read(full);
    if (content === null || !isPluginOwnedContent(full, content)) {
      continue;
    }
    try {
      await vault.remove(full);
      result.removed.push(full);
      const parent = path.split("/").slice(0, -1).join("/");
      if (parent && parent !== PAPERS_DIR && parent !== PROJECTS_DIR && parent !== GLOSSARY_DIR) {
        emptiedParents.add(parent);
      }
    } catch {
      keep.add(path);
    }
  }

  for (const parent of Array.from(emptiedParents).sort(compareCodeUnits).reverse()) {
    const full = joinVaultPath(folder, parent);
    const children = await vault.children(full);
    if (children !== null && children.length === 0) {
      try {
        await vault.remove(full);
      } catch {
        // an empty folder left behind is harmless
      }
    }
  }

  return { folder, paths: Array.from(keep).sort(compareCodeUnits) };
}

/** Canvases already in the sync folder at any path the generator can emit. */
async function existingCanvasPaths(vault: VaultWriter, folder: string): Promise<string[]> {
  const out = new Set<string>(Object.values(OVERVIEW_PATHS));
  const walk = async (relative: string, depth: number): Promise<void> => {
    const children = await vault.children(joinVaultPath(folder, relative));
    if (!children) {
      return;
    }
    for (const child of children) {
      const name = child.split("/").pop() ?? "";
      const rel = `${relative}/${name}`;
      if (name.toLowerCase().endsWith(".canvas")) {
        out.add(rel);
      } else if (depth > 0) {
        await walk(rel, depth - 1);
      }
    }
  };
  await walk(PAPERS_DIR, 1);
  await walk(PROJECTS_DIR, 0);
  await walk(TERMS_DIR, 0);
  return Array.from(out);
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function markKindFailed(result: ApplyResult, kind: PlannedWrite["kind"]): void {
  if (kind === "glossary" || kind === "index") {
    result.glossaryOk = false;
  }
  if (kind === "canvas") {
    result.canvasOk = false;
  }
  if (kind === "paper") {
    result.papersOk = false;
  }
}

async function ensureFolderTree(vault: VaultWriter, folder: string): Promise<void> {
  if (await vault.isFile(folder)) {
    throw new Error(PLUGIN_COPY.folderError);
  }
  if (!(await vault.isFolder(folder))) {
    await vault.createFolder(folder);
  }
  for (const child of [GLOSSARY_DIR, PAPERS_DIR, PROJECTS_DIR]) {
    const path = joinVaultPath(folder, child);
    if (await vault.isFile(path)) {
      throw new Error(PLUGIN_COPY.folderError);
    }
    if (!(await vault.isFolder(path))) {
      await vault.createFolder(path);
    }
  }
}

async function ensureParentFolder(vault: VaultWriter, filePath: string): Promise<void> {
  const parts = filePath.split("/");
  parts.pop();
  let cursor = "";
  for (const part of parts) {
    cursor = cursor ? `${cursor}/${part}` : part;
    if (await vault.isFile(cursor)) {
      throw new Error(PLUGIN_COPY.folderError);
    }
    if (!(await vault.isFolder(cursor))) {
      await vault.createFolder(cursor);
    }
  }
}
