/**
 * Settings preview for generated canvases.
 *
 * Two layers:
 * - Pure models (`buildPreviewModel`, `buildOutline`) computed from a
 *   `CanvasDocument`, with no DOM or `obsidian` dependency, so vitest can load
 *   them.
 * - Small DOM renderers (`renderPreviewDrawing`, `renderOutline`) in
 *   `./preview-dom`, kept separate because they use Obsidian's element
 *   helpers.
 *
 * The drawing never shows text: it is a scaled sketch of groups, cards and
 * links so a layout can be judged at a glance.
 */

import { readKindMarker } from "./markers";
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasLevel,
  CanvasNode,
  CanvasNodeKind,
  CanvasSide,
  GeneratedCanvas,
} from "./types";

// --- Colours --------------------------------------------------------------------

/**
 * JSON Canvas preset colours drawn with Obsidian's own canvas palette
 * variables (read, never redefined), so the preview matches the user's theme.
 */
export const PREVIEW_PRESET_COLORS: Record<string, string> = {
  "1": "rgb(var(--canvas-color-1))",
  "2": "rgb(var(--canvas-color-2))",
  "3": "rgb(var(--canvas-color-3))",
  "4": "rgb(var(--canvas-color-4))",
  "5": "rgb(var(--canvas-color-5))",
  "6": "rgb(var(--canvas-color-6))",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** CSS colour for a node / edge `color` value, or null when uncoloured. */
export function resolvePreviewColor(color: string | undefined): string | null {
  if (!color) return null;
  if (PREVIEW_PRESET_COLORS[color]) return PREVIEW_PRESET_COLORS[color];
  return HEX_RE.test(color) ? color.toLowerCase() : null;
}

// --- Drawing model ------------------------------------------------------------------

export interface PreviewRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  kind: CanvasNodeKind;
}

export interface PreviewEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrow: boolean;
  color: string | null;
}

export interface PreviewModel {
  /** Drawing size in CSS pixels; every shape lies within [0, width] × [0, height]. */
  width: number;
  height: number;
  /** Canvas units → drawing pixels. */
  scale: number;
  groups: PreviewRect[];
  nodes: PreviewRect[];
  edges: PreviewEdge[];
}

export interface PreviewSize {
  maxWidth: number;
  maxHeight: number;
  padding: number;
}

export const DEFAULT_PREVIEW_SIZE: PreviewSize = { maxWidth: 640, maxHeight: 420, padding: 12 };

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function sidePoint(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/** Kind of a node: the engine's metadata first, then the text marker. */
export function nodeKind(node: CanvasNode): CanvasNodeKind {
  if (node.paperCollege?.kind) return node.paperCollege.kind;
  if (node.type === "group") return "group";
  if (node.type === "text") return readKindMarker(node.text) ?? "note";
  return "note";
}

/**
 * Scales `document` to fit `size`, keeping its aspect ratio. Groups and cards
 * become rectangles, edges become side-to-side segments. No labels or text.
 */
export function buildPreviewModel(
  document: CanvasDocument,
  size: PreviewSize = DEFAULT_PREVIEW_SIZE,
): PreviewModel {
  const nodes = document.nodes;
  if (nodes.length === 0) {
    return { width: size.maxWidth, height: Math.round(size.maxHeight / 3), scale: 1, groups: [], nodes: [], edges: [] };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const inner = {
    w: Math.max(1, size.maxWidth - size.padding * 2),
    h: Math.max(1, size.maxHeight - size.padding * 2),
  };
  const scale = Math.min(inner.w / spanX, inner.h / spanY);
  const width = Math.min(size.maxWidth, Math.ceil(spanX * scale + size.padding * 2));
  const height = Math.min(size.maxHeight, Math.ceil(spanY * scale + size.padding * 2));
  const tx = (x: number) => round((x - minX) * scale + size.padding);
  const ty = (y: number) => round((y - minY) * scale + size.padding);

  const groups: PreviewRect[] = [];
  const cards: PreviewRect[] = [];
  const byId = new Map<string, CanvasNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const rect: PreviewRect = {
      id: n.id,
      x: tx(n.x),
      y: ty(n.y),
      width: round(n.width * scale),
      height: round(n.height * scale),
      color: resolvePreviewColor(n.color),
      kind: nodeKind(n),
    };
    (n.type === "group" ? groups : cards).push(rect);
  }

  const edges: PreviewEdge[] = [];
  for (const e of document.edges) {
    const from = byId.get(e.fromNode);
    const to = byId.get(e.toNode);
    if (!from || !to) continue;
    const a = sidePoint(from, e.fromSide);
    const b = sidePoint(to, e.toSide);
    edges.push({
      id: e.id,
      x1: tx(a.x),
      y1: ty(a.y),
      x2: tx(b.x),
      y2: ty(b.y),
      arrow: e.toEnd === "arrow",
      color: resolvePreviewColor(e.color),
    });
  }

  return { width, height, scale, groups, nodes: cards, edges };
}

// --- Outline model ------------------------------------------------------------------

export interface OutlineNode {
  id: string;
  type: CanvasNode["type"];
  kind: CanvasNodeKind;
  /** Short human title: first text line, group label, or file path. */
  title: string;
  file?: string;
}

export interface OutlineFile {
  path: string;
  level: CanvasLevel;
  presetId: string;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  nodes: OutlineNode[];
}

/** First readable line of a text node: markdown, links and the kind marker stripped. */
export function textTitle(text: string, max = 80): string {
  const withoutTags = text.replace(/<[^>]*>/g, "");
  const line = withoutTags
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";
  const plain = line
    .replace(/^#+\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function outlineNode(node: CanvasNode): OutlineNode {
  const kind = nodeKind(node);
  if (node.type === "group") return { id: node.id, type: node.type, kind, title: node.label };
  if (node.type === "file") return { id: node.id, type: node.type, kind, title: node.file, file: node.file };
  return { id: node.id, type: node.type, kind, title: textTitle(node.text) };
}

/** Files → nodes, in generation order (groups first within each file, as written). */
export function buildOutline(canvases: readonly GeneratedCanvas[]): OutlineFile[] {
  return canvases.map(({ path, document }) => ({
    path,
    level: document.paperCollege.canvas,
    presetId: document.paperCollege.presetId,
    nodeCount: document.nodes.filter((n) => n.type !== "group").length,
    edgeCount: document.edges.length,
    groupCount: document.nodes.filter((n) => n.type === "group").length,
    nodes: document.nodes.map(outlineNode),
  }));
}

/** Edge type re-exported for tests that build documents by hand. */
export type { CanvasEdge };
