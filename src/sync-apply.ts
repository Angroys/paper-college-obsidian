import {
  emptyCanvasDocument,
  findPdfHazards,
  isAllowedVaultPath,
  isJsonCanvas,
} from "./payload-guard";
import {
  canvasFileContents,
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
  PlannedWrite,
  SyncCanvas,
  SyncGlossaryTerm,
  SyncPaper,
  SyncPayload,
} from "./types";
import { PLUGIN_COPY } from "./copy";

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
}

export function normalizeFolderName(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? trimmed : PLUGIN_COPY.folderDefault;
}

export function buildApplyPlan(
  payload: SyncPayload,
  folderRaw: string,
): ApplyPlan {
  const folder = normalizeFolderName(folderRaw);
  const hazards = findPdfHazards(payload);
  const abortReasons = hazards.map((h) => h.reason);
  const glossaryAborted = hazards.some((h) => h.part === "glossary");
  const papersAborted = hazards.some((h) => h.part === "papers");
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
    for (const paper of papers) {
      const linked = (termsByPaper.get(paper.id) ?? [])
        .map((term) => termPaths.get(term.id))
        .filter((item): item is { term: string; path: string } => Boolean(item));
      const write = planPaperWrite(folder, paper, linked, usedPaperNames);
      if (write) {
        writes.push(write);
      }
    }
  }

  if (!canvasAborted) {
    const canvases: SyncCanvas[] = Array.isArray(payload.canvases) ? payload.canvases : [];
    if (canvases.length === 0) {
      const fallback = emptyCanvasDocument();
      const canvasPath = joinVaultPath(folder, "Projects.canvas");
      if (isAllowedVaultPath(canvasPath)) {
        writes.push({
          relativePath: canvasPath,
          content: canvasFileContents(fallback),
          kind: "canvas",
        });
      }
    } else {
      for (const entry of canvases) {
        const canvasPath = joinVaultPath(folder, entry.path);
        if (!isAllowedVaultPath(canvasPath) || !isJsonCanvas(entry.document)) {
          abortReasons.push(`canvas ${entry.path} is not valid`);
          continue;
        }
        const doc = rewriteFileNodePaths(entry.document, folder);
        writes.push({
          relativePath: canvasPath,
          content: canvasFileContents(doc),
          kind: "canvas",
        });
      }
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
  };
}

function rewriteFileNodePaths(
  document: SyncCanvas["document"],
  folder: string,
): SyncCanvas["document"] {
  const nodes = (document.nodes as Array<Record<string, unknown>>).map((node) => {
    if (node.type === "file" && typeof node.file === "string") {
      return { ...node, file: `${folder}/${node.file}` };
    }
    return node;
  });
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
): PlannedWrite | null {
  const title = paper.title?.trim() || PLUGIN_COPY.pickerUntitled;
  const basename = uniqueBasename(title, paper.id, used);
  const relativePath = joinVaultPath(folder, PAPERS_DIR, `${basename}.md`);
  if (!isAllowedVaultPath(relativePath)) {
    return null;
  }
  return {
    relativePath,
    content: paperStubMarkdown(paper, linked),
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
): Promise<ApplyResult> {
  const result: ApplyResult = {
    written: [],
    skippedUser: [],
    failed: [],
    folderError: null,
    glossaryOk: !plan.glossaryAborted,
    canvasOk: !plan.canvasAborted,
    papersOk: !plan.papersAborted,
  };

  try {
    await ensureFolderTree(vault, plan.folder);
    // Prune the legacy Mindmap.canvas if it was plugin-owned
    const legacyPath = joinVaultPath(plan.folder, LEGACY_CANVAS_FILENAME);
    const legacyContent = await vault.read(legacyPath);
    if (legacyContent !== null && hasPaperSyncMarker(legacyContent)) {
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
    if (existing !== null && !hasPaperSyncMarker(existing)) {
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
