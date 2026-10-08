import type {
  CanvasSyncHighlight,
  CanvasSyncProject,
  CanvasSyncProjectPaper,
} from "./canvas/types";
import { defaultPresetStore, type PresetStore } from "./canvas/store";

export type SyncPaper = {
  id: string;
  title: string;
  /** Cite-add provenance, when the server sends it. */
  added_from_paper_id?: string | null;
};

export type SyncGlossaryTerm = {
  id: string;
  term: string;
  explanation: string;
  tags: string[];
  rating: number | null;
  paper_id: string;
  created_at: string;
  normalized_term: string;
  highlight_id: string | null;
};

export type SyncCanvas = {
  path: string;
  document: {
    nodes: unknown[];
    edges: unknown[];
    paperCollege?: unknown;
  };
};

/**
 * A saved figure crop, metadata only (`figure_highlights` in the sync
 * payload). The PNG bytes come from `GET /api/obsidian/figures/:id`, one
 * figure at a time; `(id, updated_at)` is the "unchanged" cache key.
 */
export type SyncFigureHighlight = {
  id: string;
  paper_id: string;
  page_number: number;
  label: string | null;
  caption: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncPayload = {
  papers: SyncPaper[];
  glossary_terms: SyncGlossaryTerm[];
  projects?: CanvasSyncProject[];
  project_papers?: CanvasSyncProjectPaper[];
  highlights?: CanvasSyncHighlight[];
  /**
   * Absent when the server predates figure sync. The plugin then leaves
   * figure images it already wrote untouched instead of treating the
   * missing list as "every figure was deleted".
   */
  figure_highlights?: SyncFigureHighlight[];
  /**
   * Legacy: canvases the server used to build. Ignored — the plugin generates
   * canvases locally with the active preset. Older servers may still send it.
   */
  canvases?: SyncCanvas[];
};

/**
 * Canvas files the plugin wrote on its last sync, sync-folder relative and
 * sorted. Only these (plus legacy server-era paths) are candidates for stale
 * cleanup, so a canvas the user made themselves is never removed.
 */
export type CanvasManifest = {
  folder: string;
  paths: string[];
};

/** A figure with its resolved vault path (`<folder>/<Short title>/<file>.png`). */
export type PlacedFigure = {
  figure: SyncFigureHighlight;
  path: string;
};

/** Plugin-written figure images: figure id → what was written and where. */
export type FigureManifest = Record<string, { updated_at: string; path: string }>;

export type PaperPluginSettings = {
  baseUrl: string;
  folder: string;
  token: string;
  deviceId: string;
  accountLabel: string;
  syncOnStartup: boolean;
  lastSyncAt: string | null;
  lastPapers: SyncPaper[];
  firstRunDismissed: boolean;
  firstSyncDone: boolean;
  lastSyncError: string | null;
  lastTermCount: number;
  lastPaperCount: number;
  lastCanvasOk: boolean;
  figureManifest: FigureManifest;
  /** Short-title folders the plugin created; only these are ever removed. */
  figureFolders: string[];
  /** Versioned canvas preset store (active preset + user edits). */
  canvasPresets: PresetStore;
  /** Last sync payload, so the settings preview works offline. */
  lastPayload: SyncPayload | null;
  canvasManifest: CanvasManifest | null;
};

export const DEFAULT_SETTINGS: PaperPluginSettings = {
  baseUrl: "https://paper.college",
  folder: "Paper",
  token: "",
  deviceId: "",
  accountLabel: "",
  syncOnStartup: false,
  lastSyncAt: null,
  lastPapers: [],
  firstRunDismissed: false,
  firstSyncDone: false,
  lastSyncError: null,
  lastTermCount: 0,
  lastPaperCount: 0,
  lastCanvasOk: false,
  figureManifest: {},
  figureFolders: [],
  canvasPresets: defaultPresetStore(),
  lastPayload: null,
  canvasManifest: null,
};

export type PlannedWriteKind = "glossary" | "paper" | "canvas" | "index";

export type PlannedWrite = {
  relativePath: string;
  content: string;
  kind: PlannedWriteKind;
};

export type ApplyPlan = {
  writes: PlannedWrite[];
  folder: string;
  glossaryAborted: boolean;
  canvasAborted: boolean;
  papersAborted: boolean;
  abortReasons: string[];
  termCount: number;
  paperCount: number;
  emptyGlossary: boolean;
  /** Generated canvas paths (sync-folder relative), in write order. */
  canvasPaths: string[];
};

export type ApplyResult = {
  written: string[];
  skippedUser: string[];
  failed: string[];
  /** Stale plugin-owned canvases removed this sync (vault paths). */
  removed: string[];
  folderError: string | null;
  glossaryOk: boolean;
  canvasOk: boolean;
  papersOk: boolean;
  /** Manifest to persist; null when canvases were not touched (keep the old one). */
  canvasManifest: CanvasManifest | null;
};

export type ExchangeSuccess = {
  ok: true;
  token: string;
  deviceId: string;
  accountLabel: string;
};

export type ExchangeFailure = {
  ok: false;
  kind: "invalid_code" | "expired_code" | "offline" | "unknown";
  status: number | null;
};

export type ExchangeResult = ExchangeSuccess | ExchangeFailure;

export type SignedUrlResponse = {
  url: string;
  expiresIn: number;
};
