/**
 * Double-click zoom-focus for Paper's generated canvases.
 *
 * Double-clicking a group (project zone) or a paper card flies the viewport
 * to fit that node; Escape flies back one level to the exact viewport it
 * left, until the stack is empty. Everything else is left to Obsidian:
 * - non-generated canvases are never touched,
 * - double-clicks on empty space or other nodes keep Obsidian's behaviour
 *   (create node / edit),
 * - double-clicks on a link inside a card keep the plugin's PDF-open
 *   behaviour (`main.ts` `registerCanvasHandlers`),
 * - Escape passes through when nothing is zoomed, while editing, or while an
 *   overlay owns the keyboard.
 *
 * Obsidian's canvas is private API: it is duck-typed here (like
 * `canvas-open.ts`) and every access is null-safe. If the viewport API is
 * missing the double-click is not claimed at all.
 *
 * Pure logic lives in `canvas-zoom-logic.ts`. This module only imports
 * `obsidian` types, so its DOM wiring is unit-tested with a fake plugin.
 */

import {
  animationFrameAt,
  bboxFromRect,
  escapeDecision,
  fitViewport,
  GROUP_TOP_BAND,
  isRepeatPress,
  sameViewport,
  shouldAnimate,
  viewportMovedSince,
  ZOOM_ANIMATION_MS,
  ZoomStack,
  zoomNodeKind,
  type BBox,
  type PressRecord,
  type Viewport,
} from "./canvas-zoom-logic";
import { KIND_MARKER_ATTR, KIND_MARKER_CLASS } from "./canvas/markers";

type LiveNode = {
  id?: string;
  nodeEl?: HTMLElement;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isEditing?: boolean;
  getBBox?: () => Partial<BBox> | null | undefined;
  getData?: () => unknown;
  unknownData?: unknown;
};

type LiveCanvas = {
  x?: number;
  y?: number;
  zoom?: number;
  tx?: number;
  ty?: number;
  tZoom?: number;
  nodes?: Map<string, unknown> | Record<string, unknown>;
  selection?: Set<unknown>;
  wrapperEl?: HTMLElement;
  canvasRect?: { width?: number; height?: number } | null;
  setViewport?: (x: number, y: number, zoom: number) => void;
  zoomToBbox?: (bbox: BBox) => void;
  markViewportChanged?: () => void;
  requestFrame?: () => void;
};

type CanvasViewLike = {
  canvas?: LiveCanvas;
  file?: { path: string } | null;
  containerEl: HTMLElement;
};

type Animation = {
  frame: number;
  win: Window;
  to: Viewport;
};

type ZoomState = {
  stack: ZoomStack;
  /** Viewport the plugin last put the canvas in; null when it never did. */
  landed: Viewport | null;
  /** File the stack belongs to; a different file means a stale stack. */
  path: string | null;
  anim: Animation | null;
};

export interface CanvasZoomOptions {
  /** "Animate canvas zoom" setting. */
  animate: () => boolean;
  /** True when `vaultPath` is one of Paper's generated canvases. */
  isGenerated: (vaultPath: string) => boolean;
  /** Sync folder (vault-relative), to recognise paper file nodes by path. */
  folder: () => string;
  /** The focused workspace view, when it is a canvas view (else null). */
  activeCanvasView: () => unknown;
}

/**
 * The slice of Obsidian's `Plugin` this module uses, typed structurally so the
 * module never imports `obsidian` (the web app's typecheck reaches it through
 * the unit tests, and `obsidian` is only installed for the plugin build).
 */
export interface CanvasZoomHost {
  app: {
    workspace: {
      on(name: "layout-change", callback: () => unknown): object;
      on(name: "file-open", callback: () => unknown): object;
      on(name: "active-leaf-change", callback: () => unknown): object;
      onLayoutReady(callback: () => unknown): void;
      getLeavesOfType(viewType: string): { view: unknown }[];
    };
  };
  register(callback: () => unknown): void;
  registerEvent(eventRef: object): void;
  registerDomEvent<K extends keyof WindowEventMap>(
    el: Window,
    type: K,
    callback: (this: HTMLElement, ev: WindowEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

/** The window an element lives in (popout windows have their own). */
function windowOf(el: HTMLElement): Window {
  return el.ownerDocument?.defaultView ?? window;
}

/** Events this module claimed, so other canvas handlers can step aside. */
const claimedEvents = new WeakSet<Event>();

/** True when canvas zoom handled `event` (the PDF-open handler skips it). */
export function isZoomClaimed(event: Event): boolean {
  return claimedEvents.has(event);
}

const NODE_SELECTOR = ".canvas-node";
const OVERLAY_SELECTOR = ".modal-container, .menu, .suggestion-container";

export class CanvasZoom {
  private readonly states = new Map<CanvasViewLike, ZoomState>();
  private readonly hookedEls = new WeakSet<HTMLElement>();
  private readonly hookedWins = new WeakSet<Window>();
  private lastPress: PressRecord<Element> | null = null;

  constructor(
    private readonly plugin: CanvasZoomHost,
    private readonly options: CanvasZoomOptions,
  ) {}

  register(): void {
    const { workspace } = this.plugin.app;
    const sync = () => this.syncViews();
    this.plugin.registerEvent(workspace.on("layout-change", sync));
    this.plugin.registerEvent(workspace.on("file-open", sync));
    this.plugin.registerEvent(workspace.on("active-leaf-change", sync));
    workspace.onLayoutReady(sync);
    this.plugin.register(() => {
      this.states.forEach((state) => this.cancelAnimation(state));
      this.states.clear();
    });
  }

  // --- View bookkeeping ---------------------------------------------------------------

  private canvasViews(): CanvasViewLike[] {
    return this.plugin.app.workspace
      .getLeavesOfType("canvas")
      .map((leaf) => leaf.view as CanvasViewLike)
      .filter((view) => Boolean(view?.containerEl));
  }

  /** Hooks new canvas views; resets stacks whose view closed or switched file. */
  private syncViews(): void {
    const live = new Set(this.canvasViews());
    this.states.forEach((state, view) => {
      if (!live.has(view)) {
        this.cancelAnimation(state);
        this.states.delete(view);
      } else if ((view.file?.path ?? null) !== state.path) {
        this.resetState(state, view);
      }
    });
    live.forEach((view) => this.hook(view));
  }

  private hook(view: CanvasViewLike): void {
    const el = view.containerEl;
    if (!this.hookedEls.has(el)) {
      this.hookedEls.add(el);
      // Capture phase: runs before Obsidian's canvas handlers (inside el) and
      // before the plugin's own bubble-phase PDF-open listener on el.
      this.plugin.registerDomEvent(el, "dblclick", (ev) => this.onDoubleClick(view, ev), { capture: true });
      this.plugin.registerDomEvent(el, "pointerdown", (ev) => this.onPress(view, ev), { capture: true });
      this.plugin.registerDomEvent(el, "mousedown", (ev) => this.onPress(view, ev), { capture: true });
      this.plugin.registerDomEvent(el, "wheel", () => this.onWheel(view), { capture: true, passive: true });
    }
    const win = windowOf(el);
    if (!this.hookedWins.has(win)) {
      this.hookedWins.add(win);
      this.plugin.registerDomEvent(win, "keydown", (ev) => this.onKeyDown(ev), { capture: true });
    }
  }

  private state(view: CanvasViewLike): ZoomState {
    let state = this.states.get(view);
    const path = view.file?.path ?? null;
    if (!state) {
      state = { stack: new ZoomStack(), landed: null, path, anim: null };
      this.states.set(view, state);
    } else if (state.path !== path) {
      this.resetState(state, view);
    }
    return state;
  }

  private resetState(state: ZoomState, view: CanvasViewLike): void {
    this.cancelAnimation(state);
    state.stack.reset();
    state.landed = null;
    state.path = view.file?.path ?? null;
  }

  private isGeneratedView(view: CanvasViewLike): boolean {
    const path = view.file?.path;
    return typeof path === "string" && this.options.isGenerated(path);
  }

  /** Drops the stack when the user moved the view since the plugin landed it. */
  private dropIfMoved(state: ZoomState, canvas: LiveCanvas): void {
    if (state.anim) return;
    if (viewportMovedSince(state.landed, readViewport(canvas), readTarget(canvas))) {
      state.stack.reset();
      state.landed = null;
    }
  }

  // --- Events -------------------------------------------------------------------------

  private onDoubleClick(view: CanvasViewLike, ev: MouseEvent): void {
    if (ev.button !== 0 || claimedEvents.has(ev)) return;
    const hit = this.zoomTarget(view, ev.target);
    if (!hit) return;
    claimedEvents.add(ev);
    ev.preventDefault();
    ev.stopPropagation();

    const canvas = hit.canvas;
    const state = this.state(view);
    this.dropIfMoved(state, canvas);
    const current = state.anim ? state.anim.to : readViewport(canvas);
    if (!current) return;
    const fit = fitViewport(hit.bbox, viewSize(view, canvas), {
      topBand: hit.kind === "group" ? GROUP_TOP_BAND : 0,
    });
    if (fit) {
      if (sameViewport(fit, current)) return;
      state.stack.push(current);
      this.flyTo(view, state, canvas, fit);
    } else if (typeof canvas.zoomToBbox === "function") {
      state.stack.push(current);
      this.cancelAnimation(state);
      canvas.zoomToBbox(hit.bbox);
      state.landed = readTarget(canvas) ?? readViewport(canvas);
    }
  }

  /**
   * Second press of a double-click on a zoomable node: hidden from Obsidian
   * so a press-count based edit trigger cannot fire. Any press during an
   * animation snaps it to its end so the stack stays exact.
   */
  private onPress(view: CanvasViewLike, ev: MouseEvent): void {
    const state = this.states.get(view);
    if (state?.anim) this.finishAnimation(view, state);
    if (ev.button !== 0) return;
    // Mouse events carry a click count; pointer events may not, so time them.
    let second = ev.detail >= 2;
    if (ev.type === "pointerdown") {
      const nodeEl = ev.target instanceof Element ? ev.target.closest(NODE_SELECTOR) : null;
      second = second || isRepeatPress(this.lastPress, nodeEl, ev.timeStamp);
      this.lastPress = { target: nodeEl, time: ev.timeStamp };
    }
    if (second && this.zoomTarget(view, ev.target)) {
      ev.stopPropagation();
    }
  }

  /** Wheel during an animation: the user took over; drop the stack. */
  private onWheel(view: CanvasViewLike): void {
    const state = this.states.get(view);
    if (!state?.anim) return;
    this.cancelAnimation(state);
    state.stack.reset();
    state.landed = null;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing) return;
    const view = this.activeCanvasView();
    if (!view?.canvas) return;
    const win = windowOf(view.containerEl);
    if (ev.view && ev.view !== win) return;
    const state = this.states.get(view);
    if (!state) return;
    if ((view.file?.path ?? null) !== state.path) {
      this.resetState(state, view);
      return;
    }
    const canvas = view.canvas;
    this.dropIfMoved(state, canvas);
    const doc = view.containerEl.ownerDocument ?? win.document;
    const decision = escapeDecision({
      depth: state.stack.depth,
      generated: this.isGeneratedView(view),
      editing: isEditing(doc, canvas),
      overlayOpen: Boolean(doc.body?.querySelector(OVERLAY_SELECTOR)),
      modifiers: ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey,
    });
    if (decision !== "zoom-out") return;
    const back = state.stack.pop();
    if (!back) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.flyTo(view, state, canvas, back);
  }

  private activeCanvasView(): CanvasViewLike | null {
    const active = this.options.activeCanvasView();
    if (!active || typeof active !== "object") return null;
    const view = active as Partial<CanvasViewLike>;
    return view.containerEl ? (view as CanvasViewLike) : null;
  }

  // --- Hit testing --------------------------------------------------------------------

  private zoomTarget(
    view: CanvasViewLike,
    target: EventTarget | null,
  ): { canvas: LiveCanvas; bbox: BBox; kind: "group" | "paper-card" } | null {
    if (!(target instanceof Element)) return null;
    const canvas = view.canvas;
    if (!canvas || !hasViewportApi(canvas) || !this.isGeneratedView(view)) return null;
    // Links inside a card keep their PDF-open click; editors keep their own
    // double-click (word select).
    if (target.closest("a, input, textarea, select, [contenteditable='true'], .cm-editor, .is-editing")) {
      return null;
    }
    const nodeEl = target.closest<HTMLElement>(NODE_SELECTOR);
    if (!nodeEl) return null;
    const node = liveNodeForElement(canvas, nodeEl);
    if (!node || node.isEditing) return null;
    const kind = zoomNodeKind(nodeData(node), domKind(nodeEl), this.options.folder());
    if (kind === "other") return null;
    const bbox = nodeBBox(node);
    if (!bbox) return null;
    return { canvas, bbox, kind };
  }

  // --- Animation ----------------------------------------------------------------------

  private flyTo(view: CanvasViewLike, state: ZoomState, canvas: LiveCanvas, to: Viewport): void {
    this.cancelAnimation(state);
    const win = windowOf(view.containerEl);
    const from = readViewport(canvas);
    const reduced = Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    if (!from || !shouldAnimate(this.options.animate(), reduced) || typeof win.requestAnimationFrame !== "function") {
      this.land(state, canvas, to);
      return;
    }
    let start: number | null = null;
    const step = (now: number) => {
      if (state.anim !== anim) return;
      if (start === null) start = now;
      const elapsed = now - start;
      if (elapsed >= ZOOM_ANIMATION_MS) {
        state.anim = null;
        this.land(state, canvas, to);
        return;
      }
      applyViewport(canvas, animationFrameAt(from, to, elapsed));
      anim.frame = win.requestAnimationFrame(step);
    };
    const anim: Animation = { frame: 0, win, to };
    state.anim = anim;
    anim.frame = win.requestAnimationFrame(step);
  }

  private land(state: ZoomState, canvas: LiveCanvas, to: Viewport): void {
    applyViewport(canvas, to);
    // Read back what Obsidian actually kept (it may clamp), so the next
    // manual-move check compares like with like.
    state.landed = readTarget(canvas) ?? readViewport(canvas) ?? to;
  }

  private finishAnimation(view: CanvasViewLike, state: ZoomState): void {
    const anim = state.anim;
    if (!anim || !view.canvas) return;
    this.cancelAnimation(state);
    this.land(state, view.canvas, anim.to);
  }

  private cancelAnimation(state: ZoomState): void {
    const anim = state.anim;
    if (!anim) return;
    state.anim = null;
    anim.win.cancelAnimationFrame?.(anim.frame);
  }
}

// --- Duck-typed canvas helpers ------------------------------------------------------------

function num(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasViewportApi(canvas: LiveCanvas): boolean {
  return (
    num(canvas.x) &&
    num(canvas.y) &&
    num(canvas.zoom) &&
    (typeof canvas.setViewport === "function" || typeof canvas.markViewportChanged === "function")
  );
}

function readViewport(canvas: LiveCanvas): Viewport | null {
  return num(canvas.x) && num(canvas.y) && num(canvas.zoom) ? { x: canvas.x, y: canvas.y, zoom: canvas.zoom } : null;
}

function readTarget(canvas: LiveCanvas): Viewport | null {
  return num(canvas.tx) && num(canvas.ty) && num(canvas.tZoom)
    ? { x: canvas.tx, y: canvas.ty, zoom: canvas.tZoom }
    : null;
}

/**
 * Sets both the live viewport and Obsidian's smoothing targets so its own
 * render loop never pulls the view somewhere else mid-animation.
 */
function applyViewport(canvas: LiveCanvas, v: Viewport): void {
  try {
    canvas.setViewport?.(v.x, v.y, v.zoom);
  } catch {
    // fall through to direct assignment
  }
  if (num(canvas.x)) canvas.x = v.x;
  if (num(canvas.y)) canvas.y = v.y;
  if (num(canvas.zoom)) canvas.zoom = v.zoom;
  if (num(canvas.tx)) canvas.tx = v.x;
  if (num(canvas.ty)) canvas.ty = v.y;
  if (num(canvas.tZoom)) canvas.tZoom = v.zoom;
  canvas.markViewportChanged?.();
  canvas.requestFrame?.();
}

function viewSize(view: CanvasViewLike, canvas: LiveCanvas): { width: number; height: number } {
  const rect = canvas.wrapperEl?.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  const cached = canvas.canvasRect;
  if (cached && num(cached.width) && num(cached.height) && cached.width > 0 && cached.height > 0) {
    return { width: cached.width, height: cached.height };
  }
  const own = view.containerEl.getBoundingClientRect();
  return { width: own.width, height: own.height };
}

function liveNodes(canvas: LiveCanvas): unknown[] {
  const nodes = canvas.nodes;
  if (!nodes) return [];
  return nodes instanceof Map ? Array.from(nodes.values()) : Object.values(nodes);
}

function liveNodeForElement(canvas: LiveCanvas, nodeEl: HTMLElement): LiveNode | null {
  for (const node of liveNodes(canvas)) {
    if (node && typeof node === "object" && (node as LiveNode).nodeEl === nodeEl) {
      return node;
    }
  }
  const id = nodeEl.getAttribute("data-node-id") || nodeEl.getAttribute("data-id");
  if (!id || !canvas.nodes) return null;
  const byId = canvas.nodes instanceof Map ? canvas.nodes.get(id) : canvas.nodes[id];
  return byId && typeof byId === "object" ? (byId) : null;
}

function nodeData(node: LiveNode): Record<string, unknown> {
  let data: unknown = null;
  try {
    data = node.getData?.();
  } catch {
    data = null;
  }
  const base = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const extra =
    node.unknownData && typeof node.unknownData === "object" ? (node.unknownData as Record<string, unknown>) : {};
  return { ...extra, ...base, paperCollege: base.paperCollege ?? extra.paperCollege };
}

function domKind(nodeEl: HTMLElement): string | null {
  return (
    nodeEl.getAttribute(KIND_MARKER_ATTR) ||
    nodeEl.querySelector(`.${KIND_MARKER_CLASS}[${KIND_MARKER_ATTR}]`)?.getAttribute(KIND_MARKER_ATTR) ||
    null
  );
}

function nodeBBox(node: LiveNode): BBox | null {
  try {
    const b = node.getBBox?.();
    if (b && num(b.minX) && num(b.minY) && num(b.maxX) && num(b.maxY)) {
      return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    }
  } catch {
    // fall back to geometry fields
  }
  if (num(node.x) && num(node.y) && num(node.width) && num(node.height)) {
    return bboxFromRect({ x: node.x, y: node.y, width: node.width, height: node.height });
  }
  return null;
}

function isEditing(doc: Document, canvas: LiveCanvas): boolean {
  const active = doc.activeElement;
  if (active instanceof HTMLElement) {
    if (active.isContentEditable) return true;
    if (active.closest("input, textarea, select, .cm-editor")) return true;
  }
  if (canvas.selection instanceof Set) {
    for (const node of Array.from(canvas.selection)) {
      if (node && typeof node === "object" && (node as LiveNode).isEditing) return true;
    }
  }
  return false;
}
