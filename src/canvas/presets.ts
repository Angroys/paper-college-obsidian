/**
 * The 20 shipped canvas presets. #1 "Library tree" is the default.
 *
 * Every preset is a complete `CanvasPreset` (no optional fields): each one
 * sets structure, grouping, layout, sizes, connections, colours and CSS. They
 * are written as overrides of one base for readability, then frozen into full
 * objects at module load.
 *
 * Colours default to Paper's palette (src/app/globals.css,
 * design/tokens/obsidian-sync.json): indigo accent #4f46e5 / #818cf8 for hub
 * and project, neutral #737373 paper cards, term blue #2563eb, highlight amber
 * #d97706, notes teal #0d9488. The JSON carries the light hex; the default
 * CSS swaps in the dark value under `.theme-dark`.
 */

import { CANVAS_PRESET_COPY } from "../copy";
import { CANVAS_SCOPE_CLASS, KIND_MARKER_ATTR, KIND_MARKER_CLASS } from "./markers";
import type { CanvasPreset, KindSize, StyledKind } from "./types";

export const DEFAULT_PRESET_ID = "library-tree";

/** Shipped preset ids, in display order (#1 … #20). */
export const SHIPPED_PRESET_IDS = [
  "library-tree",
  "library-radial",
  "library-columns",
  "project-tree",
  "project-radial",
  "paper-columns",
  "paper-radial",
  "term-tree",
  "term-radial",
  "library-flat",
  "reading-desk",
  "glossary-atlas",
  "highlight-reel",
  "citation-web",
  "minimal-outline",
  "study-board",
  "project-kanban",
  "concept-spine",
  "wide-timeline",
  "dense-index",
] as const;

export type ShippedPresetId = (typeof SHIPPED_PRESET_IDS)[number];

// --- Paper palette ------------------------------------------------------------------

export const PAPER_PALETTE: Record<StyledKind, { light: string; dark: string }> = {
  hub: { light: "#4f46e5", dark: "#818cf8" },
  project: { light: "#4f46e5", dark: "#818cf8" },
  paper: { light: "#737373", dark: "#a3a3a3" },
  term: { light: "#2563eb", dark: "#60a5fa" },
  highlight: { light: "#d97706", dark: "#fbbf24" },
  note: { light: "#0d9488", dark: "#2dd4bf" },
};

const KINDS: StyledKind[] = ["hub", "project", "paper", "term", "highlight", "note"];

function paletteVars(theme: "light" | "dark"): string {
  return KINDS.map((k) => `  --paper-canvas-${k}: ${PAPER_PALETTE[k][theme]};`).join("\n");
}

/** Selector for every node of `kind`: text nodes via the marker, file nodes via the attribute the plugin sets. */
export function kindSelector(kind: string): string {
  return (
    `.${CANVAS_SCOPE_CLASS} .canvas-node[${KIND_MARKER_ATTR}="${kind}"], ` +
    `.${CANVAS_SCOPE_CLASS} .canvas-node:has(.${KIND_MARKER_CLASS}[${KIND_MARKER_ATTR}="${kind}"])`
  );
}

/**
 * Default CSS every preset starts from: plugin-owned `--paper-canvas-*`
 * variables for light and dark, a per-kind border and tint, and the marker
 * span hidden. Never redefines Obsidian core variables.
 */
export function baseCanvasCss(): string {
  const scope = `.${CANVAS_SCOPE_CLASS}`;
  const rules = KINDS.map(
    (k) =>
      `${kindSelector(k)} {\n` +
      `  --paper-canvas-kind-color: var(--paper-canvas-${k});\n` +
      `}`,
  ).join("\n");
  return [
    `.theme-light ${scope} {\n${paletteVars("light")}\n  --paper-canvas-tint: 8%;\n  --paper-canvas-radius: 10px;\n}`,
    `.theme-dark ${scope} {\n${paletteVars("dark")}\n  --paper-canvas-tint: 14%;\n  --paper-canvas-radius: 10px;\n}`,
    rules,
    `${scope} .canvas-node[${KIND_MARKER_ATTR}] .canvas-node-container,\n${scope} .canvas-node:has(.${KIND_MARKER_CLASS}) .canvas-node-container {\n` +
      `  border-color: var(--paper-canvas-kind-color);\n` +
      `  border-radius: var(--paper-canvas-radius);\n` +
      `  background-color: color-mix(in srgb, var(--paper-canvas-kind-color) var(--paper-canvas-tint), var(--background-primary));\n` +
      `}`,
    `${scope} .${KIND_MARKER_CLASS} {\n  display: none;\n}`,
  ].join("\n\n");
}

function css(extra: string): string {
  return extra ? `${baseCanvasCss()}\n\n${extra.trim()}` : baseCanvasCss();
}

const S = `.${CANVAS_SCOPE_CLASS}`;

// --- Base (= #1 Library tree) ---------------------------------------------------------

function size(minWidth: number, maxWidth: number, minHeight: number, maxHeight: number): KindSize {
  return { minWidth, maxWidth, minHeight, maxHeight };
}

const BASE: Omit<CanvasPreset, "id" | "name" | "description"> = {
  structure: {
    root: "library",
    depth: 3,
    emit: { overview: true, project: true, paper: true, term: false },
    unassigned: "bucket",
  },
  grouping: {
    terms: "separate",
    highlights: "separate",
    notes: "separate",
    projectTerms: "shared",
    sort: "alpha",
    maxTerms: 30,
    maxHighlights: 30,
  },
  layout: {
    algorithm: "tree-TB",
    siblingGap: 48,
    levelGap: 120,
    groupPadding: 24,
    groupColumns: 3,
    gridColumns: 0,
    sizing: "fixed",
    maxLines: 8,
    sizes: {
      hub: size(240, 340, 100, 220),
      project: size(200, 280, 80, 160),
      paper: size(220, 280, 80, 200),
      term: size(220, 280, 80, 260),
      highlight: size(240, 320, 80, 260),
      note: size(200, 260, 64, 320),
    },
  },
  connections: { siblings: false, backlinks: false, arrow: "end", sides: "flow" },
  look: {
    colorMode: "kind",
    kindColors: {
      hub: PAPER_PALETTE.hub.light,
      project: PAPER_PALETTE.project.light,
      paper: PAPER_PALETTE.paper.light,
      term: PAPER_PALETTE.term.light,
      highlight: PAPER_PALETTE.highlight.light,
      note: PAPER_PALETTE.note.light,
    },
    levelColors: ["#4f46e5", "#818cf8", "#737373", "#2563eb"],
    hubText: "counts",
    termText: "definition",
    highlightText: "page",
  },
  files: {
    noteNodes: { overview: false, project: false, paper: true, term: true },
    paperNode: "text",
    termNode: "text",
    backlinkToParent: true,
    paperFolders: "project",
  },
  css: css(""),
};

type Override = {
  structure?: Partial<CanvasPreset["structure"]>;
  grouping?: Partial<CanvasPreset["grouping"]>;
  layout?: Partial<Omit<CanvasPreset["layout"], "sizes">> & { sizes?: Partial<Record<StyledKind, KindSize>> };
  connections?: Partial<CanvasPreset["connections"]>;
  look?: Partial<Omit<CanvasPreset["look"], "kindColors">> & { kindColors?: Partial<Record<StyledKind, string>> };
  files?: Partial<Omit<CanvasPreset["files"], "noteNodes">> & { noteNodes?: Partial<CanvasPreset["files"]["noteNodes"]> };
  css?: string;
};

function define(id: ShippedPresetId, o: Override): CanvasPreset {
  const copy = CANVAS_PRESET_COPY[id];
  return {
    id,
    name: copy.name,
    description: copy.description,
    structure: {
      ...BASE.structure,
      ...o.structure,
      emit: { ...BASE.structure.emit, ...o.structure?.emit },
    },
    grouping: { ...BASE.grouping, ...o.grouping },
    layout: {
      ...BASE.layout,
      ...o.layout,
      sizes: { ...BASE.layout.sizes, ...o.layout?.sizes },
    },
    connections: { ...BASE.connections, ...o.connections },
    look: {
      ...BASE.look,
      ...o.look,
      kindColors: { ...BASE.look.kindColors, ...o.look?.kindColors },
      levelColors: o.look?.levelColors ?? [...BASE.look.levelColors],
    },
    files: {
      ...BASE.files,
      ...o.files,
      noteNodes: { ...BASE.files.noteNodes, ...o.files?.noteNodes },
    },
    css: o.css ?? BASE.css,
  };
}

const PRESETS: CanvasPreset[] = [
  // 1 — default.
  define("library-tree", {}),
  define("library-radial", {
    layout: { algorithm: "radial", siblingGap: 56, levelGap: 140 },
    connections: { arrow: "none", sides: "nearest" },
    css: css(`${S} .canvas-node-container {\n  border-width: 2px;\n}`),
  }),
  define("library-columns", {
    structure: { depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "bucket" },
    layout: { algorithm: "columns", siblingGap: 40, levelGap: 64 },
    connections: { arrow: "none" },
    css: css(`${kindSelector("project")} .canvas-node-container {\n  border-width: 3px;\n}`),
  }),
  define("project-tree", {
    structure: { root: "project", depth: 2, emit: { overview: true, project: true, paper: false, term: false }, unassigned: "bucket" },
    grouping: { maxTerms: 12, maxHighlights: 12, projectTerms: "shared" },
    files: { noteNodes: { project: true } },
  }),
  define("project-radial", {
    structure: { root: "project", depth: 3, unassigned: "bucket" },
    layout: { algorithm: "radial", siblingGap: 56, levelGap: 140 },
    connections: { arrow: "none", sides: "nearest" },
  }),
  define("paper-columns", {
    structure: { root: "paper", depth: 2, emit: { overview: true, project: false, paper: false, term: false }, unassigned: "root" },
    grouping: { maxTerms: 10, maxHighlights: 10 },
    layout: { algorithm: "columns", groupColumns: 1, levelGap: 64 },
    files: { noteNodes: { overview: true } },
  }),
  define("paper-radial", {
    structure: { root: "paper", depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { notes: "hidden", maxTerms: 8, maxHighlights: 8 },
    layout: { algorithm: "radial", groupColumns: 2, siblingGap: 56, levelGap: 140 },
    connections: { arrow: "none", sides: "nearest" },
  }),
  define("term-tree", {
    structure: { root: "term", depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { sort: "alpha", maxTerms: 60 },
    layout: { algorithm: "tree-LR", siblingGap: 32, levelGap: 160 },
    look: { termText: "term" },
  }),
  define("term-radial", {
    structure: { root: "term", depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { sort: "shared", maxTerms: 48 },
    layout: { algorithm: "radial", siblingGap: 40, levelGap: 140 },
    connections: { arrow: "none", sides: "nearest" },
    look: { termText: "term" },
  }),
  define("library-flat", {
    structure: { depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { terms: "merged", highlights: "merged", notes: "merged" },
  }),

  // 11–20 — custom presets; each sets colours, sizes and CSS of its own.
  define("reading-desk", {
    structure: { root: "paper", depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { sort: "date", terms: "separate", highlights: "separate", notes: "hidden", maxTerms: 12, maxHighlights: 16 },
    layout: {
      algorithm: "columns",
      sizing: "fit",
      groupColumns: 1,
      siblingGap: 56,
      levelGap: 72,
      sizes: { highlight: size(260, 380, 80, 320), term: size(200, 300, 64, 200) },
    },
    connections: { arrow: "none" },
    look: {
      kindColors: { hub: "#b45309", paper: "#78716c", highlight: "#d97706", term: "#2563eb" },
      termText: "term",
    },
    css: css(`.theme-light ${S} {\n  --paper-canvas-hub: #b45309;\n  --paper-canvas-tint: 12%;\n}\n.theme-dark ${S} {\n  --paper-canvas-hub: #f59e0b;\n}\n${kindSelector("highlight")} .canvas-node-content {\n  font-family: var(--font-text-theme, serif);\n  font-style: italic;\n}`),
  }),
  define("glossary-atlas", {
    structure: { root: "term", depth: 3, emit: { overview: true, project: false, paper: true, term: true }, unassigned: "root" },
    grouping: { sort: "shared", maxTerms: 80, maxHighlights: 12 },
    layout: { algorithm: "grid", gridColumns: 8, siblingGap: 32, levelGap: 96, sizes: { term: size(200, 240, 64, 140) } },
    connections: { arrow: "none" },
    look: { termText: "term", kindColors: { hub: "#1d4ed8", term: "#2563eb" } },
    files: { termNode: "text" },
    css: css(`.theme-light ${S} {\n  --paper-canvas-hub: #1d4ed8;\n}\n.theme-dark ${S} {\n  --paper-canvas-hub: #93c5fd;\n}\n${kindSelector("term")} .canvas-node-container {\n  border-radius: 999px;\n}`),
  }),
  define("highlight-reel", {
    structure: { root: "paper", depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { terms: "hidden", highlights: "separate", notes: "hidden", maxHighlights: 40 },
    layout: { algorithm: "tree-LR", groupColumns: 4, siblingGap: 40, levelGap: 120, sizes: { highlight: size(260, 300, 96, 220) } },
    look: { highlightText: "page", kindColors: { hub: "#d97706", highlight: "#f59e0b" } },
    css: css(`.theme-light ${S} {\n  --paper-canvas-hub: #d97706;\n  --paper-canvas-highlight: #f59e0b;\n}\n.theme-dark ${S} {\n  --paper-canvas-hub: #fbbf24;\n  --paper-canvas-highlight: #fcd34d;\n}`),
  }),
  define("citation-web", {
    structure: { depth: 2, emit: { overview: true, project: true, paper: true, term: false }, unassigned: "bucket" },
    grouping: { projectTerms: "shared" },
    layout: { algorithm: "radial", siblingGap: 64, levelGap: 160 },
    connections: { backlinks: true, arrow: "none", sides: "nearest" },
    look: { colorMode: "level", levelColors: ["#4f46e5", "#7c3aed", "#737373", "#2563eb"] },
    css: css(`${S} .canvas-edges path.canvas-display-path {\n  stroke-opacity: 0.6;\n}`),
  }),
  define("minimal-outline", {
    structure: { depth: 3 },
    grouping: { notes: "hidden", terms: "merged", highlights: "merged", maxTerms: 20, maxHighlights: 20 },
    layout: { algorithm: "tree-LR", siblingGap: 24, levelGap: 96, maxLines: 3, sizes: { term: size(180, 220, 56, 120), highlight: size(200, 240, 56, 120) } },
    connections: { arrow: "none" },
    look: { colorMode: "plain", hubText: "title", termText: "term", highlightText: "text" },
    files: { noteNodes: { paper: false, term: false } },
    css: css(`${S} .canvas-node-container {\n  border-color: var(--background-modifier-border) !important;\n  background-color: transparent !important;\n  box-shadow: none;\n}`),
  }),
  define("study-board", {
    structure: { root: "project", depth: 2, emit: { overview: true, project: true, paper: false, term: false }, unassigned: "bucket" },
    grouping: { terms: "merged", highlights: "merged", notes: "hidden", maxTerms: 16, maxHighlights: 8 },
    layout: {
      algorithm: "grid",
      gridColumns: 4,
      groupColumns: 2,
      siblingGap: 56,
      levelGap: 96,
      maxLines: 14,
      sizes: { term: size(300, 380, 120, 360), highlight: size(300, 380, 100, 300), paper: size(260, 320, 96, 200) },
    },
    look: { termText: "definition", kindColors: { term: "#0d9488", hub: "#4338ca" } },
    css: css(`.theme-light ${S} {\n  --paper-canvas-term: #0d9488;\n}\n.theme-dark ${S} {\n  --paper-canvas-term: #2dd4bf;\n}\n${S} .canvas-node-content {\n  font-size: 1.05em;\n}`),
  }),
  define("project-kanban", {
    structure: { root: "library", depth: 2, emit: { overview: true, project: true, paper: true, term: false }, unassigned: "bucket" },
    grouping: { sort: "date" },
    layout: { algorithm: "columns", siblingGap: 32, levelGap: 48, sizes: { paper: size(240, 260, 64, 120), project: size(240, 260, 64, 120) } },
    connections: { arrow: "none" },
    look: { kindColors: { project: "#4f46e5", paper: "#737373" } },
    files: { paperNode: "text" },
    css: css(`${kindSelector("project")} .canvas-node-container {\n  border-width: 0 0 4px 0;\n}\n${kindSelector("paper")} .canvas-node-container {\n  border-radius: 6px;\n}`),
  }),
  define("concept-spine", {
    structure: { root: "term", depth: 2, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { sort: "shared", maxTerms: 24 },
    layout: { algorithm: "tree-TB", siblingGap: 40, levelGap: 140 },
    connections: { siblings: true, arrow: "end" },
    look: { colorMode: "level", levelColors: ["#4f46e5", "#2563eb", "#737373", "#0d9488"], termText: "term" },
    css: css(`${kindSelector("term")} .canvas-node-container {\n  border-width: 2px;\n}`),
  }),
  define("wide-timeline", {
    structure: { root: "paper", depth: 3, emit: { overview: true, project: false, paper: true, term: false }, unassigned: "root" },
    grouping: { sort: "date", maxTerms: 12, maxHighlights: 12 },
    layout: { algorithm: "tree-TB", siblingGap: 96, levelGap: 160, sizes: { paper: size(240, 280, 96, 160) } },
    connections: { siblings: true, arrow: "end", sides: "nearest" },
    look: { kindColors: { paper: "#4f46e5" } },
    files: { paperFolders: "project" },
    css: css(`.theme-light ${S} {\n  --paper-canvas-paper: #4f46e5;\n}\n.theme-dark ${S} {\n  --paper-canvas-paper: #818cf8;\n}`),
  }),
  define("dense-index", {
    structure: { depth: 3 },
    grouping: { maxTerms: 24, maxHighlights: 12, notes: "hidden" },
    layout: {
      algorithm: "grid",
      gridColumns: 6,
      groupColumns: 4,
      siblingGap: 24,
      levelGap: 48,
      groupPadding: 12,
      maxLines: 3,
      sizes: {
        hub: size(200, 260, 72, 140),
        project: size(160, 200, 56, 100),
        paper: size(160, 200, 56, 100),
        term: size(160, 200, 48, 100),
        highlight: size(180, 220, 48, 110),
        note: size(160, 200, 48, 160),
      },
    },
    connections: { arrow: "none" },
    look: { termText: "term", highlightText: "text" },
    css: css(`${S} .canvas-node-content {\n  font-size: 0.85em;\n}`),
  }),
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** Shipped presets, frozen, in display order. Clone before editing. */
export const SHIPPED_PRESETS: readonly CanvasPreset[] = deepFreeze(PRESETS);

export function shippedPreset(id: string): CanvasPreset | null {
  return SHIPPED_PRESETS.find((p) => p.id === id) ?? null;
}

export function clonePreset(preset: CanvasPreset): CanvasPreset {
  return JSON.parse(JSON.stringify(preset)) as CanvasPreset;
}
