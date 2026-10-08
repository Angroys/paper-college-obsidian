/**
 * Types for the plugin-side canvas engine: the raw sync payload it reads, the
 * JSON Canvas 1.0 shapes it writes, and the preset data model that drives it.
 *
 * This module (and everything under `src/canvas/`) must stay free of any
 * `obsidian` import so vitest can load it and so the settings preview can run
 * it on a cached payload without a vault.
 */

// --- Raw sync payload (input) -------------------------------------------------

/**
 * The subset of `/api/obsidian/sync` the generator reads. Every collection but
 * `papers` is optional so an older server (which sent fewer arrays) still
 * yields canvases. Structurally compatible with the plugin's `SyncPayload`.
 *
 * `papers` and `glossary_terms` order is LOAD BEARING: note basenames are
 * assigned by walking those arrays in payload order (see `vault-notes.ts`
 * `uniqueBasename` and `sync-apply.ts`). Never sort them before naming.
 */
export interface CanvasSyncPayload {
  papers: CanvasSyncPaper[];
  projects?: CanvasSyncProject[];
  project_papers?: CanvasSyncProjectPaper[];
  glossary_terms?: CanvasSyncGlossaryTerm[];
  highlights?: CanvasSyncHighlight[];
}

export interface CanvasSyncPaper {
  id: string;
  title: string | null;
  /** Cite-add provenance, when the server sends it. */
  added_from_paper_id?: string | null;
}

export interface CanvasSyncProject {
  id: string;
  name: string | null;
  created_at?: string | null;
}

export interface CanvasSyncProjectPaper {
  project_id: string;
  paper_id: string;
  added_at?: string | null;
}

export interface CanvasSyncGlossaryTerm {
  id: string;
  term: string;
  explanation: string;
  tags?: string[] | null;
  rating?: number | null;
  paper_id: string;
  created_at?: string | null;
  normalized_term: string;
  highlight_id?: string | null;
}

export interface CanvasSyncHighlight {
  id: string;
  paper_id: string;
  selected_text: string;
  page_number?: number | null;
  created_at?: string | null;
}

// --- JSON Canvas 1.0 (output) ---------------------------------------------------

/** A JSON Canvas preset ("1"–"6") or a `#rrggbb` hex string. */
export type CanvasColorValue = string;

export type CanvasSide = "top" | "right" | "bottom" | "left";

/** Paper-specific metadata on a node (extra key; JSON Canvas ignores it). */
export interface CanvasNodeMeta {
  kind: CanvasNodeKind;
  /** Id of the paper / project / term / highlight the node stands for. */
  entityId?: string;
}

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColorValue;
  paperCollege: CanvasNodeMeta;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: "file";
  /** Sync-folder relative (see PATH CONTRACT in `generate.ts`). */
  file: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label: string;
}

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasGroupNode;

/** Edges never carry a `label` — not configurable. */
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: CanvasSide;
  toSide: CanvasSide;
  fromEnd: "none";
  toEnd: "none" | "arrow";
  color?: CanvasColorValue;
}

export interface CanvasDocumentMeta {
  canvas: CanvasLevel;
  presetId: string;
  schemaVersion: 3;
  source: "paper.college";
}

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  paperCollege: CanvasDocumentMeta;
}

/** One `.canvas` file; `path` is sync-folder relative. */
export interface GeneratedCanvas {
  path: string;
  document: CanvasDocument;
}

// --- Kinds ----------------------------------------------------------------------

/**
 * The kinds CSS can target. Text nodes carry a marker span (see
 * `KIND_MARKER_CLASS` in `markers.ts`); file nodes are tagged by the plugin
 * via DOM observation. `more` is the "+N more" overflow note, `up` the
 * back-link to the parent canvas, `empty` an empty-state card, `group` a
 * cluster box.
 */
export type CanvasNodeKind =
  | "hub"
  | "project"
  | "paper"
  | "term"
  | "highlight"
  | "note"
  | "more"
  | "up"
  | "empty"
  | "group";

/** Kinds that own a colour and a size in a preset. */
export type StyledKind = "hub" | "project" | "paper" | "term" | "highlight" | "note";

export const STYLED_KINDS: readonly StyledKind[] = [
  "hub",
  "project",
  "paper",
  "term",
  "highlight",
  "note",
];

/** Which family of canvas a document belongs to. */
export type CanvasLevel = "overview" | "project" | "paper" | "term";

export const CANVAS_LEVELS: readonly CanvasLevel[] = ["overview", "project", "paper", "term"];

// --- Preset model -----------------------------------------------------------------

export type RootKind = "library" | "project" | "paper" | "term";
export type CanvasDepth = 2 | 3;
export type UnassignedMode = "bucket" | "root" | "hidden";
export type ClusterMode = "separate" | "merged" | "hidden";
export type ProjectTermsMode = "all" | "shared" | "none";
export type SortMode = "alpha" | "date" | "rating" | "shared";
export type LayoutAlgorithm = "tree-TB" | "tree-LR" | "radial" | "columns" | "grid";
export type SizingMode = "fixed" | "fit";
export type ArrowMode = "none" | "end";
export type SideStrategy = "flow" | "nearest";
export type ColorMode = "level" | "kind" | "plain";
export type HubTextMode = "title" | "counts" | "counts-link";
export type TermTextMode = "definition" | "term";
export type HighlightTextMode = "page" | "text";
export type EntityNodeMode = "text" | "file";
export type PaperFolderMode = "project" | "flat";

export interface KindSize {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface PresetStructure {
  root: RootKind;
  /** 2 = one overview with children inline; 3 = separate canvases to click through. */
  depth: CanvasDepth;
  /** Which canvas families to write. `overview` is the root canvas (`Projects.canvas`, …). */
  emit: Record<CanvasLevel, boolean>;
  unassigned: UnassignedMode;
}

export interface PresetGrouping {
  terms: ClusterMode;
  highlights: ClusterMode;
  notes: ClusterMode;
  projectTerms: ProjectTermsMode;
  sort: SortMode;
  /** 0 = no cap. Over the cap a "+N more" note is added. */
  maxTerms: number;
  maxHighlights: number;
}

export interface PresetLayout {
  algorithm: LayoutAlgorithm;
  siblingGap: number;
  levelGap: number;
  groupPadding: number;
  /** Columns inside a cluster group. */
  groupColumns: number;
  /** Columns for the `grid` algorithm; 0 = auto (≈ square). */
  gridColumns: number;
  sizing: SizingMode;
  /** Text nodes are truncated to roughly this many wrapped lines; 0 = no limit. */
  maxLines: number;
  sizes: Record<StyledKind, KindSize>;
}

export interface PresetConnections {
  /** Chain consecutive siblings. */
  siblings: boolean;
  /** Cross-reference edges: shared term → every paper on the canvas, cite provenance. */
  backlinks: boolean;
  arrow: ArrowMode;
  sides: SideStrategy;
}

export interface PresetLook {
  colorMode: ColorMode;
  kindColors: Record<StyledKind, CanvasColorValue>;
  /** Index = hierarchy level (0 = hub); deeper levels reuse the last entry. */
  levelColors: [CanvasColorValue, CanvasColorValue, CanvasColorValue, CanvasColorValue];
  hubText: HubTextMode;
  termText: TermTextMode;
  highlightText: HighlightTextMode;
}

export interface PresetFiles {
  /** Show note file nodes (`Papers/*.md`, `Glossary/*.md`) per canvas family. */
  noteNodes: Record<CanvasLevel, boolean>;
  /** `file` = live embed of the paper's `.md` note; `text` = a text card. */
  paperNode: EntityNodeMode;
  termNode: EntityNodeMode;
  /** Link each child canvas back up to its parent canvas. */
  backlinkToParent: boolean;
  /** `project` = `Papers/<Project>/<Paper>.canvas`; `flat` = `Papers/<Paper>.canvas`. */
  paperFolders: PaperFolderMode;
}

export interface CanvasPreset {
  id: string;
  name: string;
  description: string;
  structure: PresetStructure;
  grouping: PresetGrouping;
  layout: PresetLayout;
  connections: PresetConnections;
  look: PresetLook;
  files: PresetFiles;
  /** Injected scoped under `CANVAS_SCOPE_CLASS` while a generated canvas is open. */
  css: string;
}

export interface GenerateCanvasesOptions {
  /** Origin for paper.college links in hub text. Default `https://paper.college`. */
  origin?: string;
  /**
   * The vault sync folder, used ONLY inside Markdown wikilinks in text nodes
   * ("+N more" notes). `file` nodes and `path`s stay folder-relative.
   */
  folder?: string;
}
