/**
 * Layout algorithms. Each proposes a desired top-left for every block of a
 * tree; none of them is responsible for avoiding overlaps — the shared pass in
 * `place.ts` runs afterwards and settles every collision the same way.
 *
 * A block is a single node or a whole cluster group (sized beforehand). The
 * band above a group (its label) is part of the block's height here so
 * levels leave room for it.
 */

import type { LayoutAlgorithm } from "./types";
import { round } from "./text";

export interface LayoutBlock {
  id: string;
  width: number;
  height: number;
  /** Label band reserved above the block (groups). */
  padTop: number;
  children: LayoutBlock[];
}

export interface LayoutSpacing {
  siblingGap: number;
  levelGap: number;
  gridColumns: number;
}

export type Positions = Map<string, { x: number; y: number }>;

/** Full outer height (label band + box). */
function outerH(block: LayoutBlock): number {
  return block.height + block.padTop;
}

function setTopLeft(out: Positions, block: LayoutBlock, left: number, outerTop: number): void {
  out.set(block.id, { x: round(left), y: round(outerTop + block.padTop) });
}

/** Blocks in breadth-first order with their depth (root = 0). */
export function breadthFirst(root: LayoutBlock): Array<{ block: LayoutBlock; depth: number }> {
  const out: Array<{ block: LayoutBlock; depth: number }> = [];
  const queue: Array<{ block: LayoutBlock; depth: number }> = [{ block: root, depth: 0 }];
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i];
    out.push(entry);
    for (const child of entry.block.children) queue.push({ block: child, depth: entry.depth + 1 });
  }
  return out;
}

// --- Top-down / left-right tidy tree ------------------------------------------

function treeTB(root: LayoutBlock, s: LayoutSpacing, out: Positions): void {
  const levelH: number[] = [];
  for (const { block, depth } of breadthFirst(root)) {
    levelH[depth] = Math.max(levelH[depth] ?? 0, outerH(block));
  }
  const levelY: number[] = [];
  let y = 0;
  for (let d = 0; d < levelH.length; d += 1) {
    levelY[d] = y;
    y += levelH[d] + s.levelGap;
  }
  const span = new Map<string, number>();
  const measure = (block: LayoutBlock): number => {
    let kids = 0;
    block.children.forEach((child, i) => {
      kids += measure(child) + (i > 0 ? s.siblingGap : 0);
    });
    const w = Math.max(block.width, kids);
    span.set(block.id, w);
    return w;
  };
  measure(root);
  const place = (block: LayoutBlock, left: number, depth: number): void => {
    const w = span.get(block.id) ?? block.width;
    setTopLeft(out, block, left + (w - block.width) / 2, levelY[depth]);
    let kidsW = 0;
    block.children.forEach((child, i) => {
      kidsW += (span.get(child.id) ?? child.width) + (i > 0 ? s.siblingGap : 0);
    });
    let x = left + (w - kidsW) / 2;
    for (const child of block.children) {
      place(child, x, depth + 1);
      x += (span.get(child.id) ?? child.width) + s.siblingGap;
    }
  };
  place(root, 0, 0);
}

function treeLR(root: LayoutBlock, s: LayoutSpacing, out: Positions): void {
  const levelW: number[] = [];
  for (const { block, depth } of breadthFirst(root)) {
    levelW[depth] = Math.max(levelW[depth] ?? 0, block.width);
  }
  const levelX: number[] = [];
  let x = 0;
  for (let d = 0; d < levelW.length; d += 1) {
    levelX[d] = x;
    x += levelW[d] + s.levelGap;
  }
  const span = new Map<string, number>();
  const measure = (block: LayoutBlock): number => {
    let kids = 0;
    block.children.forEach((child, i) => {
      kids += measure(child) + (i > 0 ? s.siblingGap : 0);
    });
    const h = Math.max(outerH(block), kids);
    span.set(block.id, h);
    return h;
  };
  measure(root);
  const place = (block: LayoutBlock, top: number, depth: number): void => {
    const h = span.get(block.id) ?? outerH(block);
    setTopLeft(out, block, levelX[depth], top + (h - outerH(block)) / 2);
    let kidsH = 0;
    block.children.forEach((child, i) => {
      kidsH += (span.get(child.id) ?? outerH(child)) + (i > 0 ? s.siblingGap : 0);
    });
    let y = top + (h - kidsH) / 2;
    for (const child of block.children) {
      place(child, y, depth + 1);
      y += (span.get(child.id) ?? outerH(child)) + s.siblingGap;
    }
  };
  place(root, 0, 0);
}

// --- Radial ------------------------------------------------------------------------

function leafWeight(block: LayoutBlock, memo: Map<string, number>): number {
  if (block.children.length === 0) {
    memo.set(block.id, 1);
    return 1;
  }
  let sum = 0;
  for (const child of block.children) sum += leafWeight(child, memo);
  memo.set(block.id, sum);
  return sum;
}

function radial(root: LayoutBlock, s: LayoutSpacing, out: Positions): void {
  const weights = new Map<string, number>();
  leafWeight(root, weights);
  const levels: LayoutBlock[][] = [];
  for (const { block, depth } of breadthFirst(root)) {
    (levels[depth] ??= []).push(block);
  }
  const spanOf = (b: LayoutBlock): number => Math.max(b.width, outerH(b));
  const radii: number[] = [0];
  let prevHalf = spanOf(root) / 2;
  for (let d = 1; d < levels.length; d += 1) {
    const blocks = levels[d];
    const maxSpan = Math.max(...blocks.map(spanOf));
    const circumference = blocks.reduce((sum, b) => sum + spanOf(b) + s.siblingGap, 0);
    const byCircumference = circumference / (2 * Math.PI);
    radii[d] = Math.max(radii[d - 1] + prevHalf + s.levelGap + maxSpan / 2, byCircumference);
    prevHalf = maxSpan / 2;
  }
  const center = (block: LayoutBlock, cx: number, cy: number): void => {
    out.set(block.id, {
      x: round(cx - block.width / 2),
      y: round(cy - block.height / 2 + block.padTop / 2),
    });
  };
  center(root, 0, 0);
  const assign = (block: LayoutBlock, depth: number, start: number, end: number): void => {
    const total = weights.get(block.id) ?? 1;
    let a = start;
    for (const child of block.children) {
      const share = ((end - start) * (weights.get(child.id) ?? 1)) / total;
      const mid = a + share / 2;
      const r = radii[depth + 1];
      center(child, r * Math.cos(mid), r * Math.sin(mid));
      assign(child, depth + 1, a, a + share);
      a += share;
    }
  };
  assign(root, 0, -Math.PI / 2 - Math.PI / Math.max(1, root.children.length), (3 * Math.PI) / 2 - Math.PI / Math.max(1, root.children.length));
}

// --- Columns (kanban) ---------------------------------------------------------------

function columns(root: LayoutBlock, s: LayoutSpacing, out: Positions): void {
  const cols = root.children.map((head) => {
    const stack: LayoutBlock[] = [];
    const walk = (b: LayoutBlock): void => {
      stack.push(b);
      for (const c of b.children) walk(c);
    };
    walk(head);
    return stack;
  });
  const widths = cols.map((stack) => Math.max(...stack.map((b) => b.width)));
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? s.siblingGap : 0), 0);
  const rowTop = outerH(root) + s.levelGap;
  setTopLeft(out, root, (total - root.width) / 2, 0);
  let x = 0;
  cols.forEach((stack, i) => {
    let y = rowTop;
    stack.forEach((b, j) => {
      setTopLeft(out, b, x + (widths[i] - b.width) / 2, y);
      y += outerH(b) + (j === 0 ? s.levelGap : s.siblingGap);
    });
    x += widths[i] + s.siblingGap;
  });
}

// --- Grid ----------------------------------------------------------------------------

function grid(root: LayoutBlock, s: LayoutSpacing, out: Positions): void {
  const rest = breadthFirst(root)
    .slice(1)
    .map((e) => e.block);
  const n = rest.length;
  const cols = s.gridColumns > 0 ? s.gridColumns : Math.max(1, Math.ceil(Math.sqrt(n)));
  const cellW = n > 0 ? Math.max(...rest.map((b) => b.width)) : root.width;
  const gridW = Math.min(n, cols) * cellW + Math.max(0, Math.min(n, cols) - 1) * s.siblingGap;
  setTopLeft(out, root, (gridW - root.width) / 2, 0);
  let y = outerH(root) + s.levelGap;
  for (let i = 0; i < n; i += cols) {
    const row = rest.slice(i, i + cols);
    const rowH = Math.max(...row.map(outerH));
    row.forEach((b, j) => {
      setTopLeft(out, b, j * (cellW + s.siblingGap) + (cellW - b.width) / 2, y);
    });
    y += rowH + s.siblingGap;
  }
}

/** Desired top-left for every block of the tree. */
export function layoutTree(
  root: LayoutBlock,
  algorithm: LayoutAlgorithm,
  spacing: LayoutSpacing,
): Positions {
  const out: Positions = new Map();
  switch (algorithm) {
    case "tree-LR":
      treeLR(root, spacing, out);
      break;
    case "radial":
      radial(root, spacing, out);
      break;
    case "columns":
      columns(root, spacing, out);
      break;
    case "grid":
      grid(root, spacing, out);
      break;
    default:
      treeTB(root, spacing, out);
  }
  return out;
}
