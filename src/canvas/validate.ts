/**
 * Validators for generated canvases. Exported for tests and for a debug
 * check before writing; they never mutate input.
 */

import type { CanvasDocument, CanvasNode } from "./types";
import { GROUP_LABEL_BAND } from "./generate";

export interface OverlapProblem {
  kind: "node-overlap" | "group-overlap" | "group-crossing";
  a: string;
  b: string;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin = 0,
): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

function contains(outer: CanvasNode, inner: CanvasNode): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Lists every layout violation:
 *   - two non-group nodes overlap;
 *   - two groups overlap (label band included, plus `groupMargin`);
 *   - a node intersects a group without lying fully inside it, or lies
 *     inside more than one group.
 */
export function findOverlaps(document: CanvasDocument, groupMargin = 0): OverlapProblem[] {
  const problems: OverlapProblem[] = [];
  const groups = document.nodes.filter((n) => n.type === "group");
  const items = document.nodes.filter((n) => n.type !== "group");

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (overlaps(items[i], items[j])) problems.push({ kind: "node-overlap", a: items[i].id, b: items[j].id });
    }
  }
  const banded = groups.map((g) => ({ x: g.x, y: g.y - GROUP_LABEL_BAND, width: g.width, height: g.height + GROUP_LABEL_BAND }));
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      if (overlaps(banded[i], banded[j], groupMargin)) problems.push({ kind: "group-overlap", a: groups[i].id, b: groups[j].id });
    }
  }
  for (const item of items) {
    let inside = 0;
    groups.forEach((g, gi) => {
      if (!overlaps(item, banded[gi])) return;
      if (contains(g, item)) inside += 1;
      else problems.push({ kind: "group-crossing", a: item.id, b: g.id });
    });
    if (inside > 1) problems.push({ kind: "group-crossing", a: item.id, b: "multiple-groups" });
  }
  return problems;
}

/** Ids of edges that carry a `label` key (must be none). */
export function findEdgeLabels(document: CanvasDocument): string[] {
  return document.edges
    .filter((e) => Object.prototype.hasOwnProperty.call(e, "label"))
    .map((e) => e.id);
}

const SIDES = ["top", "right", "bottom", "left"];
const ENDS = ["none", "arrow"];
const COLOR_RE = /^(?:[1-6]|#[0-9a-fA-F]{6})$/;

/** JSON Canvas 1.0 structural check; returns human-readable errors (empty = valid). */
export function validateJsonCanvas(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["document is not an object"];
  const doc = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(doc.nodes)) errors.push("nodes is not an array");
  if (!Array.isArray(doc.edges)) errors.push("edges is not an array");
  if (errors.length > 0) return errors;

  const ids = new Set<string>();
  for (const raw of doc.nodes as unknown[]) {
    const n = raw as Record<string, unknown>;
    const id = typeof n.id === "string" ? n.id : "";
    if (!id) errors.push("node without id");
    if (ids.has(id)) errors.push(`duplicate node id ${id}`);
    ids.add(id);
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof n[key] !== "number" || !Number.isInteger(n[key])) errors.push(`node ${id}: ${key} is not an integer`);
    }
    if ((n.width as number) <= 0 || (n.height as number) <= 0) errors.push(`node ${id}: non-positive size`);
    if (n.color !== undefined && (typeof n.color !== "string" || !COLOR_RE.test(n.color))) {
      errors.push(`node ${id}: bad color`);
    }
    if (n.type === "text") {
      if (typeof n.text !== "string") errors.push(`node ${id}: text missing`);
    } else if (n.type === "file") {
      if (typeof n.file !== "string" || !n.file) errors.push(`node ${id}: file missing`);
    } else if (n.type === "group") {
      if (n.label !== undefined && typeof n.label !== "string") errors.push(`node ${id}: bad label`);
    } else if (n.type === "link") {
      if (typeof n.url !== "string") errors.push(`node ${id}: url missing`);
    } else {
      errors.push(`node ${id}: unknown type`);
    }
  }
  const edgeIds = new Set<string>();
  for (const raw of doc.edges as unknown[]) {
    const e = raw as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    if (!id) errors.push("edge without id");
    if (edgeIds.has(id) || ids.has(id)) errors.push(`duplicate edge id ${id}`);
    edgeIds.add(id);
    if (typeof e.fromNode !== "string" || !ids.has(e.fromNode)) errors.push(`edge ${id}: bad fromNode`);
    if (typeof e.toNode !== "string" || !ids.has(e.toNode)) errors.push(`edge ${id}: bad toNode`);
    for (const key of ["fromSide", "toSide"]) {
      if (e[key] !== undefined && !SIDES.includes(e[key] as string)) errors.push(`edge ${id}: bad ${key}`);
    }
    for (const key of ["fromEnd", "toEnd"]) {
      if (e[key] !== undefined && !ENDS.includes(e[key] as string)) errors.push(`edge ${id}: bad ${key}`);
    }
    if (e.color !== undefined && (typeof e.color !== "string" || !COLOR_RE.test(e.color))) {
      errors.push(`edge ${id}: bad color`);
    }
  }
  return errors;
}
