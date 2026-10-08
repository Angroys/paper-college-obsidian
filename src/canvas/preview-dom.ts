/**
 * DOM renderers for the canvas settings preview. They draw the pure models
 * from `./preview` with Obsidian's element helpers, so they live apart from
 * `./preview` (which vitest and the root typecheck load without `obsidian`).
 * They only touch the container's own document, so they work in popout
 * windows too.
 */

import { CANVAS_KIND_LABELS } from "../copy";
import type { OutlineFile, PreviewModel } from "./preview";

type Attrs = Record<string, string | number>;

function attrs(values: Attrs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(values)) out[key] = String(values[key]);
  return out;
}

let markerSeq = 0;

/**
 * Draws `model` as an inline SVG inside `container` (cleared first). Colours
 * come from the model; uncoloured shapes fall back to the stylesheet. No text.
 */
export function renderPreviewDrawing(container: HTMLElement, model: PreviewModel, label: string): void {
  container.empty();
  const svg = container.createSvg("svg", {
    cls: "paper-canvas-preview-svg",
    attr: attrs({
      viewBox: `0 0 ${model.width} ${model.height}`,
      width: model.width,
      height: model.height,
      role: "img",
      "aria-label": label,
    }),
  });

  const markerId = `paper-canvas-preview-arrow-${++markerSeq}`;
  const marker = svg.createSvg("defs").createSvg("marker", {
    attr: attrs({
      id: markerId,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
    }),
  });
  marker.createSvg("path", { cls: "paper-canvas-preview-arrow", attr: { d: "M 0 0 L 10 5 L 0 10 z" } });

  for (const g of model.groups) {
    const a: Attrs = { x: g.x, y: g.y, width: g.width, height: g.height, rx: 4 };
    if (g.color) a.stroke = g.color;
    svg.createSvg("rect", { cls: "paper-canvas-preview-group", attr: attrs(a) });
  }
  for (const e of model.edges) {
    const a: Attrs = { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
    if (e.color) a.stroke = e.color;
    if (e.arrow) a["marker-end"] = `url(#${markerId})`;
    svg.createSvg("line", { cls: "paper-canvas-preview-edge", attr: attrs(a) });
  }
  for (const n of model.nodes) {
    const a: Attrs = {
      x: n.x,
      y: n.y,
      width: Math.max(1, n.width),
      height: Math.max(1, n.height),
      rx: 2,
      "data-paper-kind": n.kind,
    };
    if (n.color) {
      a.stroke = n.color;
      a.fill = n.color;
    }
    svg.createSvg("rect", { cls: "paper-canvas-preview-node", attr: attrs(a) });
  }
}

/** Renders the files → nodes outline inside `container` (cleared first). */
export function renderOutline(container: HTMLElement, files: readonly OutlineFile[], selectedPath: string): void {
  container.empty();
  const list = container.createEl("ul", { cls: "paper-canvas-outline" });
  for (const file of files) {
    const details = list.createEl("li").createEl("details");
    details.open = file.path === selectedPath;
    details.createEl("summary", { cls: "paper-canvas-outline-file", text: file.path });
    const nodes = details.createEl("ul");
    for (const node of file.nodes) {
      const li = nodes.createEl("li", {
        cls: "paper-canvas-outline-node",
        attr: { "data-paper-kind": node.kind },
      });
      li.createSpan({ cls: "paper-canvas-outline-kind", text: CANVAS_KIND_LABELS[node.kind] });
      li.appendText(` ${node.title || node.id}`);
    }
  }
}
