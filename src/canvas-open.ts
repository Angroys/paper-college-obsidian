import { paperIdFromCanvasNode } from "./urls";

type CanvasLike = {
  nodes?: Map<string, unknown> | Record<string, unknown>;
  files?: unknown;
};

type CanvasViewLike = {
  canvas?: CanvasLike;
  file?: { path: string };
  containerEl?: HTMLElement;
};

/**
 * Resolve a paper id from a Canvas activation without creating vault files
 * or treating a local `.pdf` path as the destination.
 */
export function paperIdFromCanvasEvent(
  view: CanvasViewLike | null | undefined,
  event: Event,
  canvasDocument?: { nodes?: unknown[] } | null,
): string | null {
  const nodeId = nodeIdFromEvent(event);
  if (!nodeId) {
    const href = hrefFromEvent(event);
    if (href) {
      return paperIdFromCanvasNode({ text: href });
    }
    return null;
  }

  const live = nodeFromCanvas(view?.canvas, nodeId);
  const fromLive = paperIdFromCanvasNode(live);
  if (fromLive) {
    return fromLive;
  }

  const fromDoc = nodeFromDocument(canvasDocument, nodeId);
  const fromJson = paperIdFromCanvasNode(fromDoc);
  if (fromJson) {
    return fromJson;
  }

  const href = hrefFromEvent(event);
  if (href) {
    return paperIdFromCanvasNode({ text: href });
  }
  return null;
}

function nodeIdFromEvent(event: Event): string | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const nodeEl = target.closest<HTMLElement>(
    ".canvas-node, .canvas-node-container, [data-node-id]",
  );
  if (!nodeEl) {
    return null;
  }
  return (
    nodeEl.getAttribute("data-node-id") ||
    nodeEl.getAttribute("data-id") ||
    nodeEl.dataset.nodeId ||
    nodeEl.dataset.id ||
    null
  );
}

function hrefFromEvent(event: Event): string | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const anchor = target.closest("a");
  if (!anchor) {
    return null;
  }
  return anchor.getAttribute("href") || anchor.getAttribute("data-href");
}

function nodeFromCanvas(canvas: CanvasLike | undefined, nodeId: string): unknown {
  if (!canvas?.nodes) {
    return null;
  }
  if (canvas.nodes instanceof Map) {
    return canvas.nodes.get(nodeId) ?? null;
  }
  return canvas.nodes[nodeId] ?? null;
}

function nodeFromDocument(
  doc: { nodes?: unknown[] } | null | undefined,
  nodeId: string,
): unknown {
  if (!doc?.nodes) {
    return null;
  }
  return doc.nodes.find((node) => {
    return Boolean(
      node &&
        typeof node === "object" &&
        "id" in node &&
        (node as { id: unknown }).id === nodeId,
    );
  });
}
