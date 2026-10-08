/**
 * Scoped preset CSS for generated canvases.
 *
 * While one of Paper's generated canvases is open, the plugin:
 * - adds `CANVAS_SCOPE_CLASS` to that canvas view's container element,
 * - adopts one plugin-owned constructed stylesheet holding the active
 *   preset's CSS, every selector forced under the scope class, and
 * - tags `.canvas-node` elements with `data-paper-kind` by watching the
 *   canvas DOM (MutationObserver) and matching each node's on-screen geometry
 *   (or its file name) to the node it stands for in the canvas JSON.
 *
 * Only public DOM is used; Obsidian's private canvas API is never touched.
 * Nothing here imports `obsidian`: the pure helpers are unit-tested and the
 * `CanvasCssInjector` class only needs DOM globals.
 */

import { isGeneratedCanvasPath } from "./generate";
import { CANVAS_SCOPE_CLASS, KIND_MARKER_ATTR } from "./markers";
import type { CanvasDocument, CanvasNode, CanvasNodeKind } from "./types";

// --- Path helpers ---------------------------------------------------------------------

/** `vaultPath` relative to the sync `folder`, or null when outside it. */
export function folderRelativePath(vaultPath: string, folder: string): string | null {
  const f = folder.replace(/^\/+|\/+$/g, "");
  const p = vaultPath.replace(/^\/+/, "");
  if (!f) return p;
  return p.startsWith(`${f}/`) ? p.slice(f.length + 1) : null;
}

export interface ManifestLike {
  folder: string;
  paths: string[];
}

/**
 * True when `vaultPath` names a canvas Paper wrote (or could have written)
 * under the sync folder: listed in the manifest, or matching the generator's
 * path vocabulary. Callers confirm with `isGeneratedCanvasContent`.
 */
export function isGeneratedCanvasFile(
  vaultPath: string,
  folder: string,
  manifest: ManifestLike | null | undefined,
): boolean {
  if (!vaultPath.endsWith(".canvas")) return false;
  const rel = folderRelativePath(vaultPath, folder);
  if (rel === null) return false;
  if (manifest && manifest.folder === folder && manifest.paths.includes(rel)) return true;
  return isGeneratedCanvasPath(rel);
}

/** Parses canvas file text and returns it when Paper generated it; null otherwise. */
export function parseGeneratedCanvas(text: string): CanvasDocument | null {
  try {
    const doc = JSON.parse(text) as Partial<CanvasDocument> | null;
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.nodes)) return null;
    if (doc.paperCollege?.source !== "paper.college") return null;
    return {
      nodes: doc.nodes,
      edges: Array.isArray(doc.edges) ? doc.edges : [],
      paperCollege: doc.paperCollege,
    };
  } catch {
    return null;
  }
}

export function isGeneratedCanvasContent(text: string): boolean {
  return parseGeneratedCanvas(text) !== null;
}

/**
 * Kind for a file node's (sync-folder relative) path:
 * `Papers/*.md` and `Papers/**.canvas` → paper, `Glossary/*.md` and
 * `Terms/*.canvas` → term, `Projects/*.canvas` → project, overview canvases
 * (`Projects.canvas`, `Papers.canvas`, `Terms.canvas`) → up.
 */
export function kindForFilePath(path: string): CanvasNodeKind | null {
  if (/^(Projects|Papers|Terms)\.canvas$/.test(path)) return "up";
  if (/^Projects\/[^/]+\.canvas$/.test(path)) return "project";
  if (/^Papers\/[^/]+\.md$/.test(path)) return "paper";
  if (/^Papers\/(?:[^/]+\/)?[^/]+\.canvas$/.test(path)) return "paper";
  if (/^Glossary\/[^/]+\.md$/.test(path)) return "term";
  if (/^Terms\/[^/]+\.canvas$/.test(path)) return "term";
  return null;
}

/** Kind of a node in a generated document: metadata first, then its file path. */
export function documentNodeKind(node: CanvasNode): CanvasNodeKind | null {
  if (node.paperCollege?.kind) return node.paperCollege.kind;
  if (node.type === "group") return "group";
  if (node.type === "file") return kindForFilePath(node.file);
  return null;
}

/** Key a node's geometry so a DOM node can be matched to its JSON node. */
export function geometryKey(x: number, y: number, width: number, height: number): string {
  return `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`;
}

/**
 * Reads a `.canvas-node` element's canvas geometry from its inline style
 * (`transform: translate(Xpx, Ypx)`, `width`, `height`). Null when absent.
 */
export function geometryFromStyle(style: {
  transform?: string;
  width?: string;
  height?: string;
}): string | null {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style.transform ?? "");
  const w = parseFloat(style.width ?? "");
  const h = parseFloat(style.height ?? "");
  if (!m || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return geometryKey(parseFloat(m[1]), parseFloat(m[2]), w, h);
}

function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.(md|canvas)$/, "");
}

export interface KindIndex {
  byGeometry: Map<string, CanvasNodeKind>;
  /** File node basenames (no extension) → kind, for label fallback. */
  byFileName: Map<string, CanvasNodeKind>;
}

export function buildKindIndex(document: CanvasDocument): KindIndex {
  const byGeometry = new Map<string, CanvasNodeKind>();
  const byFileName = new Map<string, CanvasNodeKind>();
  for (const node of document.nodes) {
    const kind = documentNodeKind(node);
    if (!kind) continue;
    byGeometry.set(geometryKey(node.x, node.y, node.width, node.height), kind);
    if (node.type === "file") byFileName.set(basename(node.file), kind);
  }
  return { byGeometry, byFileName };
}

// --- CSS scoping -------------------------------------------------------------------------

const SCOPE = `.${CANVAS_SCOPE_CLASS}`;
const SCOPE_TOKEN_RE = new RegExp(`\\.${CANVAS_SCOPE_CLASS}(?![\\w-])`);
const THEME_PREFIX_RE = /^((?:body|html)?\.theme-(?:light|dark))\s+(?![>+~])/;
const NESTING_AT_RULES = /^@(media|supports|container|layer|document)\b/i;
const VERBATIM_AT_RULES = /^@(-webkit-|-moz-)?(keyframes|font-face|counter-style|property)\b/i;

/** Splits on `sep` at depth 0 (outside (), [] and quotes). */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

/**
 * True when `selector` can only match the scope element or its descendants:
 * the scope class sits in a top-level compound (not inside `:not()`/`:has()`)
 * and is not followed by a sibling combinator.
 */
export function isScopedSelector(selector: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  // Blank out bracketed / quoted parts so only top-level compounds remain.
  let flat = "";
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      flat += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      flat += " ";
    } else if (c === "(" || c === "[") {
      depth++;
      flat += " ";
    } else if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      flat += " ";
    } else {
      flat += depth === 0 ? c : " ";
    }
  }
  const match = SCOPE_TOKEN_RE.exec(flat);
  if (!match) return false;
  const rest = flat.slice(match.index + match[0].length);
  // Rest of the scope's own compound, then the next combinator.
  const combinator = /^[^\s>+~]*\s*([>+~]?)/.exec(rest);
  const next = combinator ? combinator[1] : "";
  if (next === "+" || next === "~") return false;
  // A later sibling combinator applied to the scope's ancestors chain is fine;
  // only the scope compound itself matters.
  return true;
}

/** Forces one selector under the scope class. */
export function scopeSelector(selector: string): string {
  const s = selector.trim();
  if (!s) return s;
  if (isScopedSelector(s)) return s;
  if (/^(:root|html|body)$/.test(s)) return SCOPE;
  const theme = THEME_PREFIX_RE.exec(s);
  if (theme) return `${theme[1]} ${SCOPE} ${s.slice(theme[0].length)}`;
  if (/^(\.theme-(light|dark)|body\.theme-(light|dark))$/.test(s)) return `${s} ${SCOPE}`;
  return `${SCOPE} ${s}`;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Index of the `}` closing the block opened at `open`, or -1. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function scopeBlock(css: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    // Statement at-rules (`@import`, `@charset`, `@namespace`): dropped, they
    // could pull in unscoped CSS.
    if (semi !== -1 && (open === -1 || semi < open)) {
      i = semi + 1;
      continue;
    }
    if (open === -1) break;
    const close = matchBrace(css, open);
    if (close === -1) break; // unbalanced tail: drop it
    const prelude = css.slice(i, open).trim();
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (!prelude) continue;
    if (prelude.startsWith("@")) {
      if (NESTING_AT_RULES.test(prelude)) out.push(`${prelude} {\n${scopeBlock(body)}\n}`);
      else if (VERBATIM_AT_RULES.test(prelude)) out.push(`${prelude} {${body}}`);
      // Anything else (@page, @font-feature-values, …) is dropped.
      continue;
    }
    const selectors = splitTopLevel(prelude, ",")
      .map(scopeSelector)
      .filter((sel) => sel.length > 0);
    if (selectors.length === 0) continue;
    // Nested rules inside a style block (CSS nesting) resolve relative to the
    // already-scoped parent, so the body is kept verbatim.
    out.push(`${selectors.join(",\n")} {${body}}`);
  }
  return out.join("\n");
}

/**
 * Rewrites user / preset CSS so it can only apply under `CANVAS_SCOPE_CLASS`:
 * every selector is scoped (theme prefixes kept outside the scope), nesting
 * at-rules are scoped recursively, `@import` and other statement at-rules are
 * dropped, and an unbalanced tail is discarded.
 */
export function scopeCss(css: string): string {
  return scopeBlock(stripComments(css ?? ""));
}

// --- DOM injector ---------------------------------------------------------------------------

const NODE_SELECTOR = ".canvas-node";

interface Attached {
  observer: MutationObserver;
  index: KindIndex;
  frame: number | null;
}

/**
 * Owns the plugin's constructed stylesheet (one per document, for popout
 * windows) and the scope class / kind tags on canvas view containers.
 */
export class CanvasCssInjector {
  private css = "";
  private readonly sheets = new Map<Document, CSSStyleSheet>();
  private readonly attached = new Map<HTMLElement, Attached>();

  /** Sets the active preset's raw CSS (scoped here) and updates every adopted sheet. */
  setCss(rawCss: string): void {
    this.css = scopeCss(rawCss);
    this.sheets.forEach((sheet) => sheet.replaceSync(this.css));
  }

  /** Scopes `container` (a canvas view's container) for `document`, tagging file nodes. */
  attach(container: HTMLElement, document: CanvasDocument): void {
    const index = buildKindIndex(document);
    const existing = this.attached.get(container);
    if (existing) {
      existing.index = index;
      this.tagAll(container, index);
      return;
    }
    container.classList.add(CANVAS_SCOPE_CLASS);
    this.adopt(container.ownerDocument);
    const entry: Attached = {
      index,
      frame: null,
      observer: new MutationObserver(() => {
        const win = container.ownerDocument.defaultView;
        if (!win || entry.frame !== null) return;
        entry.frame = win.requestAnimationFrame(() => {
          entry.frame = null;
          this.tagAll(container, entry.index);
        });
      }),
    };
    entry.observer.observe(container, { childList: true, subtree: true });
    this.attached.set(container, entry);
    this.tagAll(container, index);
  }

  /** Removes the scope from `container`; drops the stylesheet when its document has none left. */
  detach(container: HTMLElement): void {
    const entry = this.attached.get(container);
    if (!entry) return;
    entry.observer.disconnect();
    if (entry.frame !== null) container.ownerDocument.defaultView?.cancelAnimationFrame(entry.frame);
    this.attached.delete(container);
    container.classList.remove(CANVAS_SCOPE_CLASS);
    container.querySelectorAll(`${NODE_SELECTOR}[${KIND_MARKER_ATTR}]`).forEach((el) => {
      el.removeAttribute(KIND_MARKER_ATTR);
    });
    const doc = container.ownerDocument;
    let stillUsed = false;
    this.attached.forEach((_entry, el) => {
      if (el.ownerDocument === doc) stillUsed = true;
    });
    if (!stillUsed) this.unadopt(doc);
  }

  /** Detaches every container not in `keep`. */
  retainOnly(keep: ReadonlySet<HTMLElement>): void {
    for (const el of Array.from(this.attached.keys())) {
      if (!keep.has(el) || !el.isConnected) this.detach(el);
    }
  }

  isAttached(container: HTMLElement): boolean {
    return this.attached.has(container);
  }

  destroy(): void {
    for (const el of Array.from(this.attached.keys())) this.detach(el);
    this.sheets.forEach((_sheet, doc) => this.unadopt(doc));
    this.sheets.clear();
  }

  private adopt(doc: Document): void {
    if (this.sheets.has(doc)) return;
    const win = doc.defaultView as (Window & { CSSStyleSheet: typeof CSSStyleSheet }) | null;
    if (!win) return;
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(this.css);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    this.sheets.set(doc, sheet);
  }

  private unadopt(doc: Document): void {
    const sheet = this.sheets.get(doc);
    if (!sheet) return;
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
    this.sheets.delete(doc);
  }

  private tagAll(container: HTMLElement, index: KindIndex): void {
    container.querySelectorAll<HTMLElement>(NODE_SELECTOR).forEach((el) => {
      const kind = kindForElement(el, index);
      if (kind) {
        if (el.getAttribute(KIND_MARKER_ATTR) !== kind) el.setAttribute(KIND_MARKER_ATTR, kind);
      } else if (el.hasAttribute(KIND_MARKER_ATTR)) {
        el.removeAttribute(KIND_MARKER_ATTR);
      }
    });
  }
}

/** Kind for a rendered `.canvas-node`: geometry match first, then its file-name label. */
function kindForElement(el: HTMLElement, index: KindIndex): CanvasNodeKind | null {
  const key = geometryFromStyle({
    transform: el.style.transform,
    width: el.style.width,
    height: el.style.height,
  });
  if (key) {
    const kind = index.byGeometry.get(key);
    if (kind) return kind;
  }
  const label = el.querySelector(".canvas-node-label, .markdown-embed-title, .file-embed-title");
  const name = label?.textContent?.trim();
  return name ? index.byFileName.get(name) ?? null : null;
}
