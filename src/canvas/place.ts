/**
 * The ONE shared collision-free placement pass. Every layout algorithm only
 * proposes positions; this pass runs after it (inside each group, then over
 * the top-level blocks) and is what guarantees:
 *
 *   - no two boxes overlap (with `margin` clearance between them);
 *   - a group's box, including the band above it where Obsidian draws its
 *     label, is clear of every other block — so nothing outside a group
 *     crosses its border, and groups never overlap each other.
 *
 * Deterministic: boxes are placed in the given order; a box that collides is
 * moved to the nearest free candidate position (Manhattan distance, ties by
 * candidate generation order). A free candidate always exists — directly
 * below everything placed so far — so the pass always terminates. All output
 * coordinates are integers.
 */

import { round } from "./text";

export interface PlacementBox {
  id: string;
  /** Desired top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Extra clearance reserved above the box (group label band). */
  padTop?: number;
}

export interface Placed {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectOf(x: number, y: number, box: PlacementBox): Rect {
  return {
    left: x,
    top: y - (box.padTop ?? 0),
    right: x + box.width,
    bottom: y + box.height,
  };
}

/** True when the rects are closer than `margin` on both axes. */
function collides(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.left < b.right + margin &&
    b.left < a.right + margin &&
    a.top < b.bottom + margin &&
    b.top < a.bottom + margin
  );
}

function isFree(rect: Rect, placed: Rect[], margin: number): boolean {
  for (const other of placed) {
    if (collides(rect, other, margin)) return false;
  }
  return true;
}

/**
 * Resolves `boxes` (in priority order) into collision-free integer
 * positions, returned in the same order.
 */
export function resolvePlacement(boxes: readonly PlacementBox[], margin: number): Placed[] {
  const gap = Math.max(0, round(margin));
  const placed: Rect[] = [];
  const out: Placed[] = [];
  let lowest = Number.NEGATIVE_INFINITY;

  for (const box of boxes) {
    const pad = box.padTop ?? 0;
    const want: Placed = { x: round(box.x), y: round(box.y) };
    let at = want;

    if (!isFree(rectOf(want.x, want.y, box), placed, gap)) {
      const candidates: Placed[] = [];
      for (const r of placed) {
        candidates.push(
          { x: r.right + gap, y: want.y },
          { x: r.left - gap - box.width, y: want.y },
          { x: want.x, y: r.bottom + gap + pad },
          { x: want.x, y: r.top - gap - box.height },
        );
      }
      // Always-free fallback: below every box placed so far.
      candidates.push({ x: want.x, y: lowest + gap + pad });

      const order = candidates
        .map((c, index) => ({ c, index, d: Math.abs(c.x - want.x) + Math.abs(c.y - want.y) }))
        .sort((a, b) => a.d - b.d || a.index - b.index);
      at = candidates[candidates.length - 1];
      for (const { c } of order) {
        if (isFree(rectOf(c.x, c.y, box), placed, gap)) {
          at = c;
          break;
        }
      }
    }

    const rect = rectOf(at.x, at.y, box);
    placed.push(rect);
    lowest = Math.max(lowest, rect.bottom);
    out.push({ x: round(at.x), y: round(at.y) });
  }
  return out;
}
