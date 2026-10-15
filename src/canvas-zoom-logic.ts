/**
 * Pure logic for "double-click to zoom-focus" on Paper's generated canvases.
 *
 * Nothing here imports `obsidian` or touches the DOM: the zoom stack, the
 * fit-to-bbox math, node-kind detection, the Escape decision and the easing
 * all run under vitest. `canvas-zoom.ts` wires them to Obsidian's (private,
 * duck-typed) canvas view.
 *
 * Viewport model (Obsidian canvas internals): `x` / `y` are the canvas
 * coordinates shown at the CENTRE of the view, and `zoom` is log2 of the
 * scale (scale = 2^zoom, so 0 = 100 %, 1 = 200 %, -1 = 50 %).
 */

import { kindForFilePath, folderRelativePath } from "./canvas/css-injector";
import { paperIdFromCanvasNode } from "./urls";

export interface Viewport {
  x: number;
  y: number;
  /** log2 scale. */
  zoom: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Size {
  width: number;
  height: number;
}

// --- Zoom stack -------------------------------------------------------------------------

/**
 * Viewports to return to, innermost last. Each double-click zoom pushes the
 * viewport it left; each Escape pops one and flies back to it exactly.
 */
export class ZoomStack {
  private readonly items: Viewport[] = [];

  get depth(): number {
    return this.items.length;
  }

  push(viewport: Viewport): void {
    this.items.push({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
  }

  /** The viewport to return to, or null when nothing is zoomed. */
  pop(): Viewport | null {
    return this.items.pop() ?? null;
  }

  peek(): Viewport | null {
    const top = this.items[this.items.length - 1];
    return top ? { ...top } : null;
  }

  reset(): void {
    this.items.length = 0;
  }
}

// --- Viewport comparison ----------------------------------------------------------------

/** Canvas-unit / log-zoom tolerances for "the same viewport". */
export const VIEWPORT_EPSILON = { position: 0.5, zoom: 0.001 };

export function sameViewport(a: Viewport | null | undefined, b: Viewport | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= VIEWPORT_EPSILON.position &&
    Math.abs(a.y - b.y) <= VIEWPORT_EPSILON.position &&
    Math.abs(a.zoom - b.zoom) <= VIEWPORT_EPSILON.zoom
  );
}

/**
 * True when the user moved the view since the plugin last landed it (wheel,
 * drag-pan, zoom controls, keyboard shortcuts…). `current` is the live
 * viewport; `target` is the canvas's own animation target when it has one.
 * Either matching the landed viewport counts as "not moved", so Obsidian
 * settling its own smoothing never reads as a manual change.
 */
export function viewportMovedSince(
  landed: Viewport | null,
  current: Viewport | null,
  target?: Viewport | null,
): boolean {
  if (!landed || !current) return false;
  if (sameViewport(landed, current)) return false;
  if (target && sameViewport(landed, target)) return false;
  return true;
}

// --- Fit math ---------------------------------------------------------------------------

export interface FitOptions {
  /** Screen pixels kept clear around the box on every side. */
  paddingPx: number;
  /** Extra canvas units above the box (a group's label sits above it). */
  topBand: number;
  minZoom: number;
  maxZoom: number;
}

/** Obsidian's canvas zoom range is roughly [-4, 1] (6.25 %–200 %). */
export const DEFAULT_FIT: FitOptions = {
  paddingPx: 48,
  topBand: 0,
  minZoom: -4,
  maxZoom: 1,
};

/** Group labels render in a band just above the group's box. */
export const GROUP_TOP_BAND = 40;

export function bboxFromRect(rect: { x: number; y: number; width: number; height: number }): BBox {
  return { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
}

/** `bbox` grown by `top` canvas units upward. */
export function withTopBand(bbox: BBox, top: number): BBox {
  return { ...bbox, minY: bbox.minY - Math.max(0, top) };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Viewport that centres `bbox` and scales it to fill `view` minus padding.
 * Padding is capped at a quarter of each view dimension so tiny panes still
 * get a usable fit. Returns null on degenerate input.
 */
export function fitViewport(bbox: BBox, view: Size, options: Partial<FitOptions> = {}): Viewport | null {
  const opts = { ...DEFAULT_FIT, ...options };
  const box = withTopBand(bbox, opts.topBand);
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  if (
    ![box.minX, box.minY, box.maxX, box.maxY, view.width, view.height].every(Number.isFinite) ||
    bw <= 0 ||
    bh <= 0 ||
    view.width <= 0 ||
    view.height <= 0
  ) {
    return null;
  }
  const padX = Math.min(Math.max(0, opts.paddingPx), view.width / 4);
  const padY = Math.min(Math.max(0, opts.paddingPx), view.height / 4);
  const scale = Math.min((view.width - 2 * padX) / bw, (view.height - 2 * padY) / bh);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    zoom: clamp(Math.log2(scale), opts.minZoom, opts.maxZoom),
  };
}

// --- Node kind --------------------------------------------------------------------------

export type ZoomNodeKind = "group" | "paper-card" | "other";

/**
 * What a double-click on this node should do. `data` is the node's JSON (live
 * `getData()` merged with `unknownData`, or the canvas file entry); `domKind`
 * is the `data-paper-kind` marker the CSS injector put on its element;
 * `folder` resolves vault paths of file nodes to sync-folder paths.
 */
export function zoomNodeKind(data: unknown, domKind?: string | null, folder?: string): ZoomNodeKind {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const meta =
    record.paperCollege && typeof record.paperCollege === "object"
      ? (record.paperCollege as Record<string, unknown>)
      : {};
  if (record.type === "group" || meta.kind === "group") return "group";
  if (meta.kind === "paper" || domKind === "paper") return "paper-card";
  if (meta.kind || domKind) return "other";
  if (typeof record.file === "string" && folder !== undefined) {
    const rel = folderRelativePath(record.file, folder);
    if (rel !== null && kindForFilePath(rel) === "paper") return "paper-card";
  }
  if (paperIdFromCanvasNode(record)) return "paper-card";
  return "other";
}

// --- Escape -----------------------------------------------------------------------------

export interface EscapeContext {
  /** Zoom levels stacked on the active canvas view. */
  depth: number;
  /** The active view is a Paper-generated canvas. */
  generated: boolean;
  /** Focus is in an input / textarea / contenteditable, or a node is being edited. */
  editing: boolean;
  /** A modal, menu or other overlay owns the keyboard. */
  overlayOpen: boolean;
  /** Modifier keys held (Esc with modifiers is someone else's shortcut). */
  modifiers: boolean;
}

export type EscapeDecision = "zoom-out" | "passthrough";

export function escapeDecision(ctx: EscapeContext): EscapeDecision {
  if (!ctx.generated || ctx.editing || ctx.overlayOpen || ctx.modifiers) return "passthrough";
  return ctx.depth > 0 ? "zoom-out" : "passthrough";
}

// --- Animation --------------------------------------------------------------------------

export const ZOOM_ANIMATION_MS = 300;

export function easeInOutCubic(t: number): number {
  const p = clamp(t, 0, 1);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Linear blend; zoom is already log-scale, so this is a geometric scale blend. */
export function interpolateViewport(from: Viewport, to: Viewport, t: number): Viewport {
  const p = clamp(t, 0, 1);
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    zoom: from.zoom + (to.zoom - from.zoom) * p,
  };
}

/** Viewport `elapsedMs` into an eased animation; exactly `to` once done. */
export function animationFrameAt(from: Viewport, to: Viewport, elapsedMs: number, durationMs = ZOOM_ANIMATION_MS): Viewport {
  if (durationMs <= 0 || elapsedMs >= durationMs) return { ...to };
  return interpolateViewport(from, to, easeInOutCubic(Math.max(0, elapsedMs) / durationMs));
}

/** Animate unless the setting is off or the OS asks for reduced motion. */
export function shouldAnimate(settingOn: boolean, prefersReducedMotion: boolean): boolean {
  return settingOn && !prefersReducedMotion;
}

// --- Double-press detection ---------------------------------------------------------------

/** Max gap between the two presses of a double-click (OS default is ~500 ms). */
export const DOUBLE_PRESS_MS = 500;

export interface PressRecord<T = unknown> {
  /** The node element pressed (null for empty canvas). */
  target: T | null;
  time: number;
}

/** True when this press is the second press of a double-click on the same node. */
export function isRepeatPress<T>(
  previous: PressRecord<T> | null,
  target: T | null,
  time: number,
  windowMs = DOUBLE_PRESS_MS,
): boolean {
  if (!previous || target === null || previous.target !== target) return false;
  const gap = time - previous.time;
  return gap >= 0 && gap <= windowMs;
}
