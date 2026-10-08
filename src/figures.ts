import type { FigureImageResult } from "./api";
import { PLUGIN_COPY } from "./copy";
import {
  GLOSSARY_DIR,
  joinVaultPath,
  normalizeFolderName,
  PAPERS_DIR,
  PROJECTS_DIR,
  type VaultWriter,
} from "./sync-apply";
import type {
  FigureManifest,
  PlacedFigure,
  SyncPaper,
  SyncPayload,
} from "./types";
import { sanitizeFilename, shortTitle } from "./vault-notes";

/**
 * Figure images: `<syncFolder>/<Short title>/p<page>-<label or n>.png`.
 *
 * Naming is a pure function of the payload (never of vault state), walked in
 * id order, so the same payload always yields the same paths. Writes are
 * limited to `.png` files the plugin itself recorded in its manifest; a file
 * the user put at a target path is left alone.
 */

/** Binary-capable vault, used only for figure PNGs. */
export interface FigureVault extends VaultWriter {
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file, or a folder that is already empty. */
  remove(path: string): Promise<void>;
  isEmptyFolder(path: string): Promise<boolean>;
}

export type FigureSyncState = {
  manifest: FigureManifest;
  folders: string[];
};

export type FigureSyncResult = {
  state: FigureSyncState;
  /** Figures whose image is in the vault now (the note embeds only these). */
  available: PlacedFigure[];
  written: string[];
  renamed: string[];
  skipped: string[];
  skippedUser: string[];
  removed: string[];
  missing: string[];
  failed: string[];
};

// The sync folder already holds these; a paper titled "Papers …" must not
// pour its images into the notes folder.
const RESERVED_FOLDERS = [GLOSSARY_DIR, PAPERS_DIR, PROJECTS_DIR];

// Obsidian wikilinks cannot contain these, and every image is embedded as
// `![[path]]`.
const LINK_UNSAFE = /[#^[\]|]/g;

function linkSafe(name: string): string {
  return name.replace(LINK_UNSAFE, "-");
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reserves `base`, or `base-2`, `base-3`, … (case-insensitive). */
function reserve(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base}-${n}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * Short-title folder per paper id. Every paper takes part (not only those
 * with figures), walked in id order, so adding a figure to one paper never
 * renames another paper's folder.
 */
export function figureFolderNames(papers: SyncPaper[]): Map<string, string> {
  const used = new Set(RESERVED_FOLDERS.map((name) => name.toLowerCase()));
  const result = new Map<string, string>();
  for (const paper of [...papers].sort(byId)) {
    if (result.has(paper.id)) {
      continue;
    }
    const title = paper.title?.trim() || PLUGIN_COPY.pickerUntitled;
    result.set(paper.id, reserve(linkSafe(shortTitle(title)), used));
  }
  return result;
}

/** `p4-Figure-2` from page 4 + "Figure 2"; `p4-<n>` when unlabeled. */
export function figureBasename(
  page: number,
  label: string | null,
  unlabeledIndex: number,
): string {
  const trimmed = label?.trim();
  if (!trimmed) {
    return `p${page}-${unlabeledIndex}`;
  }
  const segment = linkSafe(sanitizeFilename(trimmed)).replace(/\s+/g, "-");
  return `p${page}-${segment}`;
}

/**
 * Vault path for every figure whose paper is in the payload, in figure-id
 * order. `null` when the payload carries no figure list at all (older
 * server), which callers treat as "leave figure images alone".
 */
export function planFigurePlacements(
  payload: SyncPayload,
  folderRaw: string,
): PlacedFigure[] | null {
  if (!Array.isArray(payload.figure_highlights)) {
    return null;
  }
  const folder = normalizeFolderName(folderRaw);
  const folders = figureFolderNames(payload.papers ?? []);
  const figures = [...payload.figure_highlights].sort(byId);

  const unlabeledCounts = new Map<string, number>();
  const usedPerFolder = new Map<string, Set<string>>();
  const placed: PlacedFigure[] = [];

  for (const figure of figures) {
    const shortFolder = folders.get(figure.paper_id);
    if (!shortFolder) {
      continue;
    }
    let index = 0;
    if (!figure.label?.trim()) {
      const key = `${figure.paper_id}\u0000${figure.page_number}`;
      index = (unlabeledCounts.get(key) ?? 0) + 1;
      unlabeledCounts.set(key, index);
    }
    const used = usedPerFolder.get(shortFolder) ?? new Set<string>();
    usedPerFolder.set(shortFolder, used);
    const basename = reserve(
      figureBasename(figure.page_number, figure.label, index),
      used,
    );
    placed.push({
      figure,
      path: joinVaultPath(folder, shortFolder, `${basename}.png`),
    });
  }
  return placed;
}

function isPngPath(path: string): boolean {
  return path.toLowerCase().endsWith(".png");
}

function sortedManifest(manifest: FigureManifest): FigureManifest {
  const sorted: FigureManifest = {};
  for (const id of Object.keys(manifest).sort()) {
    sorted[id] = manifest[id];
  }
  return sorted;
}

/**
 * Brings figure PNGs in line with `placements`, one download at a time.
 *
 * - Unchanged (same id, `updated_at` and path, file present): skipped.
 * - Same `updated_at`, new path (title or label change): renamed in place
 *   when nothing else claims either path; otherwise re-downloaded.
 * - 404: the figure is gone on Paper; dropped from the manifest, and its old
 *   file is removed below like any other deleted figure.
 * - Any other failure keeps the previous image and manifest entry, and the
 *   sync carries on with the next figure (auth failure stops downloading).
 * - Files in the previous manifest that no figure owns any more are
 *   removed, then empty Short-title folders the plugin created.
 */
export async function syncFigures(
  vault: FigureVault,
  fetchImage: (figureId: string) => Promise<FigureImageResult>,
  placements: PlacedFigure[],
  previous: FigureSyncState,
  folderRaw: string,
): Promise<FigureSyncResult> {
  const folder = normalizeFolderName(folderRaw);
  const prev = previous.manifest ?? {};
  const result: FigureSyncResult = {
    state: { manifest: { ...prev }, folders: [...(previous.folders ?? [])] },
    available: [],
    written: [],
    renamed: [],
    skipped: [],
    skippedUser: [],
    removed: [],
    missing: [],
    failed: [],
  };

  if (await vault.isFile(folder)) {
    result.failed.push(folder);
    return result;
  }

  const ownedBefore = new Set(Object.values(prev).map((entry) => entry.path));
  const targeted = new Set(placements.map((p) => p.path));
  const folders = new Set(previous.folders ?? []);
  const next: FigureManifest = {};
  let stopDownloads = false;

  const ensureFolders = async (filePath: string): Promise<void> => {
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
        if (cursor !== folder && cursor.startsWith(`${folder}/`)) {
          folders.add(cursor);
        }
      }
    }
  };

  // Keep the previously written image when this sync could not replace it,
  // unless another figure now claims that path.
  const keepPrevious = async (placed: PlacedFigure): Promise<void> => {
    const entry = prev[placed.figure.id];
    if (!entry) {
      return;
    }
    if (entry.path !== placed.path && targeted.has(entry.path)) {
      return;
    }
    if (await vault.isFile(entry.path)) {
      next[placed.figure.id] = entry;
      result.available.push({ figure: placed.figure, path: entry.path });
    }
  };

  for (const placed of placements) {
    const { figure, path } = placed;
    const entry = prev[figure.id];

    if (!isPngPath(path)) {
      result.failed.push(path);
      continue;
    }

    if (
      entry &&
      entry.updated_at === figure.updated_at &&
      entry.path === path &&
      (await vault.isFile(path))
    ) {
      next[figure.id] = entry;
      result.skipped.push(path);
      result.available.push(placed);
      continue;
    }

    if ((await vault.exists(path)) && !ownedBefore.has(path)) {
      result.skippedUser.push(path);
      await keepPrevious(placed);
      continue;
    }

    if (
      entry &&
      entry.updated_at === figure.updated_at &&
      !targeted.has(entry.path) &&
      !(await vault.exists(path)) &&
      (await vault.isFile(entry.path))
    ) {
      try {
        await ensureFolders(path);
        await vault.rename(entry.path, path);
        next[figure.id] = { updated_at: figure.updated_at, path };
        result.renamed.push(path);
        result.available.push(placed);
        continue;
      } catch {
        // fall through to a fresh download
      }
    }

    if (stopDownloads) {
      result.failed.push(path);
      await keepPrevious(placed);
      continue;
    }

    const fetched = await fetchImage(figure.id);
    if (!fetched.ok) {
      if (fetched.kind === "missing") {
        result.missing.push(figure.id);
        continue;
      }
      if (fetched.kind === "auth") {
        stopDownloads = true;
      }
      result.failed.push(path);
      await keepPrevious(placed);
      continue;
    }

    try {
      await ensureFolders(path);
      await vault.writeBinary(path, fetched.data);
      next[figure.id] = { updated_at: figure.updated_at, path };
      result.written.push(path);
      result.available.push(placed);
    } catch {
      result.failed.push(path);
      await keepPrevious(placed);
    }
  }

  // Remove plugin-written images no figure owns any more.
  const ownedAfter = new Set(Object.values(next).map((entry) => entry.path));
  for (const id of Object.keys(prev).sort()) {
    const entry = prev[id];
    if (ownedAfter.has(entry.path)) {
      continue;
    }
    if (!(await vault.isFile(entry.path))) {
      continue;
    }
    try {
      await vault.remove(entry.path);
      result.removed.push(entry.path);
    } catch {
      result.failed.push(entry.path);
      // Keep ownership so the next sync retries the removal.
      if (!next[id]) {
        next[id] = entry;
      }
    }
  }

  for (const path of Array.from(folders).sort().reverse()) {
    if (!(await vault.isFolder(path))) {
      folders.delete(path);
      continue;
    }
    if (await vault.isEmptyFolder(path)) {
      try {
        await vault.remove(path);
        folders.delete(path);
      } catch {
        // keep tracking it; retried next sync
      }
    }
  }

  result.state = {
    manifest: sortedManifest(next),
    folders: Array.from(folders).sort(),
  };
  return result;
}
