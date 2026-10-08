/**
 * Versioned preset storage for plugin data.
 *
 * Only user EDITS are stored (`overrides`, keyed by preset id, each a full or
 * partial preset). Shipped presets live in code, so a plugin update that adds
 * a preset makes it appear without touching saved edits. Every read goes
 * through `sanitizePreset`, so a hand-edited or older data.json can never feed
 * the generator an invalid option.
 */

import { clonePreset, DEFAULT_PRESET_ID, SHIPPED_PRESETS, shippedPreset } from "./presets";
import {
  CANVAS_LEVELS,
  STYLED_KINDS,
  type CanvasPreset,
  type KindSize,
} from "./types";

export const PRESET_STORE_VERSION = 1;

export interface PresetStore {
  version: typeof PRESET_STORE_VERSION;
  activePresetId: string;
  /** Edited presets, by id. Absent id = shipped definition. */
  overrides: Record<string, CanvasPreset>;
}

export function defaultPresetStore(): PresetStore {
  return { version: PRESET_STORE_VERSION, activePresetId: DEFAULT_PRESET_ID, overrides: {} };
}

// --- Sanitising ------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const COLOR_RE = /^(?:[1-6]|#[0-9a-fA-F]{6})$/;

export function isCanvasColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_RE.test(value);
}

function color(value: unknown, fallback: string): string {
  return isCanvasColor(value) ? value : fallback;
}

function str(value: unknown, fallback: string, max = 200): string {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : fallback;
}

function sanitizeSize(raw: unknown, base: KindSize): KindSize {
  const r = isRec(raw) ? raw : {};
  const minWidth = num(r.minWidth, 80, 1200, base.minWidth);
  const maxWidth = num(r.maxWidth, minWidth, 1600, Math.max(minWidth, base.maxWidth));
  const minHeight = num(r.minHeight, 40, 1200, base.minHeight);
  const maxHeight = num(r.maxHeight, minHeight, 2000, Math.max(minHeight, base.maxHeight));
  return { minWidth, maxWidth, minHeight, maxHeight };
}

/**
 * Deep-merges `raw` (full or partial preset, possibly malformed) onto `base`,
 * validating every field. Unknown keys are dropped. Never throws.
 */
export function sanitizePreset(raw: unknown, base: CanvasPreset): CanvasPreset {
  const r = isRec(raw) ? raw : {};
  const st = isRec(r.structure) ? r.structure : {};
  const emit = isRec(st.emit) ? st.emit : {};
  const gr = isRec(r.grouping) ? r.grouping : {};
  const la = isRec(r.layout) ? r.layout : {};
  const sizes = isRec(la.sizes) ? la.sizes : {};
  const co = isRec(r.connections) ? r.connections : {};
  const lo = isRec(r.look) ? r.look : {};
  const kc = isRec(lo.kindColors) ? lo.kindColors : {};
  const lc = Array.isArray(lo.levelColors) ? (lo.levelColors as unknown[]) : [];
  const fi = isRec(r.files) ? r.files : {};
  const nn = isRec(fi.noteNodes) ? fi.noteNodes : {};
  const b = base;

  const emitOut = {} as CanvasPreset["structure"]["emit"];
  const noteOut = {} as CanvasPreset["files"]["noteNodes"];
  for (const level of CANVAS_LEVELS) {
    emitOut[level] = bool(emit[level], b.structure.emit[level]);
    noteOut[level] = bool(nn[level], b.files.noteNodes[level]);
  }
  const sizeOut = {} as CanvasPreset["layout"]["sizes"];
  const colorOut = {} as CanvasPreset["look"]["kindColors"];
  for (const kind of STYLED_KINDS) {
    sizeOut[kind] = sanitizeSize(sizes[kind], b.layout.sizes[kind]);
    colorOut[kind] = color(kc[kind], b.look.kindColors[kind]);
  }

  return {
    id: b.id,
    name: str(r.name, b.name, 80),
    description: typeof r.description === "string" ? r.description.slice(0, 300) : b.description,
    structure: {
      root: pick(st.root, ["library", "project", "paper", "term"] as const, b.structure.root),
      depth: pick(st.depth, [2, 3] as const, b.structure.depth),
      emit: emitOut,
      unassigned: pick(st.unassigned, ["bucket", "root", "hidden"] as const, b.structure.unassigned),
    },
    grouping: {
      terms: pick(gr.terms, ["separate", "merged", "hidden"] as const, b.grouping.terms),
      highlights: pick(gr.highlights, ["separate", "merged", "hidden"] as const, b.grouping.highlights),
      notes: pick(gr.notes, ["separate", "merged", "hidden"] as const, b.grouping.notes),
      projectTerms: pick(gr.projectTerms, ["all", "shared", "none"] as const, b.grouping.projectTerms),
      sort: pick(gr.sort, ["alpha", "date", "rating", "shared"] as const, b.grouping.sort),
      maxTerms: num(gr.maxTerms, 0, 1000, b.grouping.maxTerms),
      maxHighlights: num(gr.maxHighlights, 0, 1000, b.grouping.maxHighlights),
    },
    layout: {
      algorithm: pick(la.algorithm, ["tree-TB", "tree-LR", "radial", "columns", "grid"] as const, b.layout.algorithm),
      siblingGap: num(la.siblingGap, 8, 600, b.layout.siblingGap),
      levelGap: num(la.levelGap, 16, 1000, b.layout.levelGap),
      groupPadding: num(la.groupPadding, 4, 200, b.layout.groupPadding),
      groupColumns: num(la.groupColumns, 1, 12, b.layout.groupColumns),
      gridColumns: num(la.gridColumns, 0, 50, b.layout.gridColumns),
      sizing: pick(la.sizing, ["fixed", "fit"] as const, b.layout.sizing),
      maxLines: num(la.maxLines, 0, 100, b.layout.maxLines),
      sizes: sizeOut,
    },
    connections: {
      siblings: bool(co.siblings, b.connections.siblings),
      backlinks: bool(co.backlinks, b.connections.backlinks),
      arrow: pick(co.arrow, ["none", "end"] as const, b.connections.arrow),
      sides: pick(co.sides, ["flow", "nearest"] as const, b.connections.sides),
    },
    look: {
      colorMode: pick(lo.colorMode, ["level", "kind", "plain"] as const, b.look.colorMode),
      kindColors: colorOut,
      levelColors: [
        color(lc[0], b.look.levelColors[0]),
        color(lc[1], b.look.levelColors[1]),
        color(lc[2], b.look.levelColors[2]),
        color(lc[3], b.look.levelColors[3]),
      ],
      hubText: pick(lo.hubText, ["title", "counts", "counts-link"] as const, b.look.hubText),
      termText: pick(lo.termText, ["definition", "term"] as const, b.look.termText),
      highlightText: pick(lo.highlightText, ["page", "text"] as const, b.look.highlightText),
    },
    files: {
      noteNodes: noteOut,
      paperNode: pick(fi.paperNode, ["text", "file"] as const, b.files.paperNode),
      termNode: pick(fi.termNode, ["text", "file"] as const, b.files.termNode),
      backlinkToParent: bool(fi.backlinkToParent, b.files.backlinkToParent),
      paperFolders: pick(fi.paperFolders, ["project", "flat"] as const, b.files.paperFolders),
    },
    css: typeof r.css === "string" ? r.css.slice(0, 50_000) : b.css,
  };
}

// --- Store operations ----------------------------------------------------------------

/**
 * Upgrades whatever plugin data holds (nothing, an older version, a malformed
 * object) to the current `PresetStore`. User edits for known presets are kept
 * (sanitised); edits for ids no longer shipped are dropped; presets shipped
 * after the data was saved simply appear, since only edits are stored.
 */
export function migratePresetStore(raw: unknown): PresetStore {
  const store = defaultPresetStore();
  if (!isRec(raw)) return store;

  // Pre-versioned shape: `{ presetId, presets: {...} }` from early builds.
  const overridesRaw = isRec(raw.overrides) ? raw.overrides : isRec(raw.presets) ? raw.presets : {};
  for (const id of Object.keys(overridesRaw).sort()) {
    const base = shippedPreset(id);
    if (!base) continue;
    store.overrides[id] = sanitizePreset(overridesRaw[id], base);
  }
  const active = typeof raw.activePresetId === "string" ? raw.activePresetId : raw.presetId;
  if (typeof active === "string" && shippedPreset(active)) store.activePresetId = active;
  return store;
}

/** The effective preset for `id` (edits applied); unknown ids fall back to #1. */
export function resolvePreset(store: PresetStore, id: string = store.activePresetId): CanvasPreset {
  const base = shippedPreset(id) ?? shippedPreset(DEFAULT_PRESET_ID) ?? SHIPPED_PRESETS[0];
  const override = store.overrides[base.id];
  return override ? sanitizePreset(override, base) : clonePreset(base);
}

export function activePreset(store: PresetStore): CanvasPreset {
  return resolvePreset(store, store.activePresetId);
}

/** Every preset in display order, edits applied. */
export function listPresets(store: PresetStore): CanvasPreset[] {
  return SHIPPED_PRESETS.map((p) => resolvePreset(store, p.id));
}

/** Returns a new store with `preset` saved as the edit for its id. */
export function savePreset(store: PresetStore, preset: CanvasPreset): PresetStore {
  const base = shippedPreset(preset.id);
  if (!base) return store;
  return { ...store, overrides: { ...store.overrides, [preset.id]: sanitizePreset(preset, base) } };
}

/** Returns a new store with the edits for `id` discarded. */
export function resetPreset(store: PresetStore, id: string): PresetStore {
  const overrides = { ...store.overrides };
  delete overrides[id];
  return { ...store, overrides };
}

export function setActivePreset(store: PresetStore, id: string): PresetStore {
  return shippedPreset(id) ? { ...store, activePresetId: id } : store;
}
