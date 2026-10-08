import type { CanvasNodeKind } from "./types";

/**
 * Class the plugin puts on the canvas view container while one of its own
 * generated canvases is open. Every preset's custom CSS is scoped under it, so
 * styles never reach a canvas the user made themselves.
 */
export const CANVAS_SCOPE_CLASS = "paper-canvas-scope";

/** Class of the empty marker span inside every generated text node. */
export const KIND_MARKER_CLASS = "paper-canvas-kind";

/**
 * Attribute carrying the node kind — on the marker span inside text nodes, and
 * the attribute the plugin sets on `.canvas-node` elements of file nodes it
 * recognises by path.
 */
export const KIND_MARKER_ATTR = "data-paper-kind";

/**
 * `<span class="paper-canvas-kind" data-paper-kind="term"></span>` — empty and
 * invisible; CSS targets the node with
 * `.canvas-node:has(.paper-canvas-kind[data-paper-kind="term"])`.
 */
export function kindMarker(kind: CanvasNodeKind): string {
  return `<span class="${KIND_MARKER_CLASS}" ${KIND_MARKER_ATTR}="${kind}"></span>`;
}

/**
 * Appends the marker to the end of the text's first line, so it lives inside
 * the first block (a heading or paragraph) instead of adding an empty one.
 */
export function withKindMarker(text: string, kind: CanvasNodeKind): string {
  const marker = kindMarker(kind);
  const newline = text.indexOf("\n");
  if (newline === -1) return `${text} ${marker}`;
  return `${text.slice(0, newline)} ${marker}${text.slice(newline)}`;
}

/** Reads the kind back out of a generated text node (used by tests / preview). */
export function readKindMarker(text: string): CanvasNodeKind | null {
  const match = new RegExp(`${KIND_MARKER_ATTR}="([a-z]+)"`).exec(text);
  return match ? (match[1] as CanvasNodeKind) : null;
}
