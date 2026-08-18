import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import {
  fetchSignedUrl,
  signedUrlExpired,
  type SignedUrlFetchResult,
} from "./api";
import { pdfPageLabel, pdfTabTitle, PLUGIN_COPY } from "./copy";
import { PDF_TOOLBAR_CONTROLS } from "./pdf-view-policy";
import { pdfWorkerPort } from "./pdf-worker";
import { obsidianFetch } from "./request";
import { libraryUrl, PDF_VIEW_TYPE } from "./urls";

export type PdfViewState = {
  paperId?: string;
  title?: string;
};

export interface PdfViewHost {
  getToken: () => string;
  getBaseUrl: () => string;
  openConnect: () => void;
  fetchFn?: typeof fetch;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;
const DEFAULT_ZOOM = 1.1;

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
};

type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfjsLib = {
  GlobalWorkerOptions: { workerPort: Worker | null };
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
};

/**
 * Custom ItemView: streams a signed URL into memory and paints pages.
 * Does not call vault.createBinary / fs.write, and does not expose
 * Save / Download / Add-to-vault controls.
 */
export class PaperPdfView extends ItemView {
  private paperId = "";
  private paperTitle = "";
  private zoom = DEFAULT_ZOOM;
  private pageCount: number | null = null;
  private currentPage = 1;
  private blobUrls: string[] = [];
  private pdfBytes: ArrayBuffer | null = null;
  private signedExpiresAt = 0;
  private signedUrl = "";
  private destroyed = false;
  private retrying = false;
  private refreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PdfViewHost,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PDF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return pdfTabTitle(this.paperTitle);
  }

  getState(): PdfViewState {
    return { paperId: this.paperId, title: this.paperTitle };
  }

  async setState(state: PdfViewState, result: ViewStateResult): Promise<void> {
    const record = state ?? {};
    this.paperId = typeof record.paperId === "string" ? record.paperId : "";
    this.paperTitle = typeof record.title === "string" ? record.title : "";
    await super.setState(state, result);
    await this.loadDocument();
  }

  async onOpen(): Promise<void> {
    this.destroyed = false;
    this.contentEl.empty();
    this.contentEl.addClass("paper-pdf-view");
    this.renderChrome();
    if (this.paperId) {
      await this.loadDocument();
    } else {
      this.showEmpty();
    }
  }

  async onClose(): Promise<void> {
    this.destroyed = true;
    this.clearRefreshTimer();
    this.revokeBlobs();
    this.pdfBytes = null;
    this.contentEl.empty();
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer != null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleRefresh(expiresAt: number): void {
    this.clearRefreshTimer();
    const delay = Math.max(5_000, expiresAt - Date.now() - 30_000);
    this.refreshTimer = window.setTimeout(() => {
      void this.loadDocument({ keepPages: true });
    }, delay);
  }

  private fetchFn(): typeof fetch {
    return this.host.fetchFn ?? obsidianFetch;
  }

  private revokeBlobs(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
  }

  private renderChrome(options?: {
    document?: HTMLElement;
    banner?: { kind: "info" | "error"; text: string; action?: "retry" | "reconnect" };
    zoomEnabled?: boolean;
    openEnabled?: boolean;
    pageCurrent?: number | null;
    pageTotal?: number | null;
  }): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("paper-pdf-view");

    const toolbar = root.createDiv({
      cls: "paper-pdf-toolbar",
      attr: { role: "toolbar", "aria-label": pdfTabTitle(this.paperTitle) },
    });

    const closeBtn = toolbar.createEl("button", {
      cls: "paper-pdf-btn paper-pdf-btn-close",
      text: PLUGIN_COPY.close,
      attr: { type: "button" },
    });
    closeBtn.addEventListener("click", () => this.leaf.detach());

    // A span, not a heading: heading children are invalid inside role="toolbar",
    // and Obsidian asks plugins not to style raw <h1>/<h2> themselves.
    toolbar.createEl("span", {
      cls: "paper-pdf-title",
      text: pdfTabTitle(this.paperTitle),
      attr: { title: pdfTabTitle(this.paperTitle) },
    });

    toolbar.createEl("span", {
      cls: "paper-pdf-page",
      text: pdfPageLabel(
        options?.pageCurrent ?? (this.pageCount ? this.currentPage : null),
        options?.pageTotal ?? this.pageCount,
      ),
    });

    const zoomOut = toolbar.createEl("button", {
      cls: "paper-pdf-btn paper-pdf-btn-zoom",
      text: "−",
      attr: { type: "button", "aria-label": PLUGIN_COPY.pdfZoomOut },
    });
    const zoomIn = toolbar.createEl("button", {
      cls: "paper-pdf-btn paper-pdf-btn-zoom",
      text: "+",
      attr: { type: "button", "aria-label": PLUGIN_COPY.pdfZoomIn },
    });
    const zoomEnabled = options?.zoomEnabled ?? Boolean(this.pdfBytes);
    zoomOut.disabled = !zoomEnabled || this.zoom <= ZOOM_MIN;
    zoomIn.disabled = !zoomEnabled || this.zoom >= ZOOM_MAX;
    zoomOut.addEventListener("click", () => {
      void this.setZoom(this.zoom - ZOOM_STEP);
    });
    zoomIn.addEventListener("click", () => {
      void this.setZoom(this.zoom + ZOOM_STEP);
    });

    const openBtn = toolbar.createEl("button", {
      cls: "paper-pdf-open-in-paper",
      text: PLUGIN_COPY.pdfOpenInPaper,
      attr: { type: "button" },
    });
    const openEnabled = options?.openEnabled ?? (Boolean(this.paperId) && navigator.onLine);
    openBtn.disabled = !openEnabled;
    openBtn.addEventListener("click", () => {
      if (!this.paperId) {
        return;
      }
      window.open(libraryUrl(this.host.getBaseUrl(), this.paperId), "_blank");
    });

    void PDF_TOOLBAR_CONTROLS;

    if (options?.banner) {
      const banner = root.createDiv({
        cls:
          options.banner.kind === "info"
            ? "paper-pdf-banner paper-pdf-banner-info"
            : "paper-pdf-banner paper-pdf-banner-error",
      });
      banner.createSpan({ text: options.banner.text });
      if (options.banner.action === "retry") {
        const retry = banner.createEl("button", {
          cls: "paper-pdf-btn paper-pdf-btn-retry",
          text: PLUGIN_COPY.retry,
          attr: { type: "button" },
        });
        retry.disabled = this.retrying;
        retry.addEventListener("click", () => {
          void this.loadDocument({ keepPages: options.banner?.kind === "info" });
        });
      }
      if (options.banner.action === "reconnect") {
        const reconnect = banner.createEl("button", {
          cls: "paper-pdf-btn paper-pdf-btn-reconnect",
          text: PLUGIN_COPY.connect,
          attr: { type: "button" },
        });
        reconnect.addEventListener("click", () => this.host.openConnect());
      }
    }

    const doc = root.createDiv({
      cls: "paper-pdf-document",
      attr: { role: "region", "aria-label": pdfTabTitle(this.paperTitle) },
    });
    if (options?.document) {
      doc.appendChild(options.document);
    }
  }

  private showEmpty(): void {
    const region = createDiv({
      cls: "paper-pdf-message paper-pdf-error-surface",
      text: PLUGIN_COPY.pdfErrorEmpty,
      attr: { role: "alert" },
    });
    this.renderChrome({
      document: region,
      zoomEnabled: false,
      openEnabled: false,
      pageCurrent: null,
      pageTotal: null,
    });
  }

  private showLoading(): void {
    const region = createDiv({
      cls: "paper-pdf-message",
      text: PLUGIN_COPY.pdfLoading,
      attr: { "aria-live": "polite" },
    });
    region.createDiv({ cls: "paper-pdf-progress" });
    this.renderChrome({
      document: region,
      zoomEnabled: false,
      openEnabled: Boolean(this.paperId) && navigator.onLine,
      pageCurrent: null,
      pageTotal: null,
    });
  }

  private showError(
    text: string,
    action: "retry" | "reconnect" | undefined,
    openEnabled: boolean,
  ): void {
    const region = createDiv({
      cls: "paper-pdf-message paper-pdf-error-surface",
      text,
      attr: { role: "alert" },
    });
    this.renderChrome({
      document: region,
      banner: action ? { kind: "error", text, action } : undefined,
      zoomEnabled: false,
      openEnabled,
      pageCurrent: null,
      pageTotal: null,
    });
  }

  private async setZoom(next: number): Promise<void> {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (this.pdfBytes) {
      await this.paintPages(this.pdfBytes, { keepBanner: true });
    }
  }

  private async loadDocument(opts?: { keepPages?: boolean }): Promise<void> {
    if (!this.paperId) {
      this.showEmpty();
      return;
    }
    if (!navigator.onLine) {
      this.showError(PLUGIN_COPY.pdfOffline, undefined, false);
      return;
    }

    if (!opts?.keepPages) {
      this.showLoading();
    }
    this.retrying = true;

    const signed = await this.ensureSignedUrl();
    if (this.destroyed) {
      return;
    }
    if (!signed.ok) {
      this.retrying = false;
      if (opts?.keepPages && this.pdfBytes) {
        await this.paintPages(this.pdfBytes, {
          info: PLUGIN_COPY.pdfErrorRefresh,
        });
        return;
      }
      this.mapSignedError(signed);
      return;
    }

    let bytes: ArrayBuffer;
    try {
      const response = await this.fetchFn()(signed.value.url);
      if (!response.ok) {
        throw new Error("pdf fetch failed");
      }
      bytes = await response.arrayBuffer();
    } catch {
      this.retrying = false;
      if (opts?.keepPages && this.pdfBytes) {
        await this.paintPages(this.pdfBytes, {
          info: PLUGIN_COPY.pdfErrorRefresh,
        });
        return;
      }
      if (!navigator.onLine) {
        this.showError(PLUGIN_COPY.pdfOffline, undefined, false);
        return;
      }
      this.showError(PLUGIN_COPY.pdfErrorRetry, "retry", true);
      return;
    }

    if (this.destroyed) {
      return;
    }
    this.pdfBytes = bytes;
    await this.paintPages(bytes);
    this.retrying = false;
  }

  private async ensureSignedUrl(): Promise<SignedUrlFetchResult> {
    if (
      this.signedUrl &&
      this.signedExpiresAt &&
      !signedUrlExpired(this.signedExpiresAt)
    ) {
      return {
        ok: true,
        value: { url: this.signedUrl, expiresIn: 3600 },
        expiresAt: this.signedExpiresAt,
      };
    }
    const result = await fetchSignedUrl(
      this.fetchFn(),
      this.host.getBaseUrl(),
      this.host.getToken(),
      this.paperId,
    );
    if (result.ok) {
      this.signedUrl = result.value.url;
      this.signedExpiresAt = result.expiresAt;
      this.scheduleRefresh(result.expiresAt);
    }
    return result;
  }

  private mapSignedError(result: Extract<SignedUrlFetchResult, { ok: false }>): void {
    if (result.kind === "auth") {
      this.showError(PLUGIN_COPY.pdfErrorAuth, "reconnect", true);
      return;
    }
    if (result.kind === "missing") {
      this.showError(PLUGIN_COPY.pdfErrorMissing, undefined, true);
      return;
    }
    if (result.kind === "offline") {
      this.showError(PLUGIN_COPY.pdfOffline, undefined, false);
      return;
    }
    this.showError(PLUGIN_COPY.pdfErrorRetry, "retry", true);
  }

  private async paintPages(
    bytes: ArrayBuffer,
    opts?: { keepBanner?: boolean; info?: string },
  ): Promise<void> {
    const pdfjs = await loadPdfjs();
    const data = bytes.slice(0);
    let pdf: PdfDocument;
    try {
      pdf = await pdfjs.getDocument({ data }).promise;
    } catch {
      this.showError(PLUGIN_COPY.pdfErrorRetry, "retry", true);
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.pageCount = pdf.numPages;
    this.currentPage = 1;

    const pagesRoot = createDiv({ cls: "paper-pdf-pages" });
    let failedPages = 0;

    for (let n = 1; n <= pdf.numPages; n += 1) {
      try {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: this.zoom });
        const canvas = createEl("canvas", { cls: "paper-pdf-page-canvas" });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          failedPages += 1;
          continue;
        }
        await page.render({ canvasContext: ctx, viewport }).promise;
        pagesRoot.appendChild(canvas);
      } catch {
        failedPages += 1;
      }
    }

    const info =
      failedPages > 0
        ? PLUGIN_COPY.pdfPartialPages
        : opts?.info;
    this.renderChrome({
      document: pagesRoot,
      banner: info
        ? { kind: "info", text: info, action: "retry" }
        : undefined,
      zoomEnabled: true,
      openEnabled: navigator.onLine,
      pageCurrent: 1,
      pageTotal: pdf.numPages,
    });
  }
}

let pdfjsModule: PdfjsLib | null = null;

async function loadPdfjs(): Promise<PdfjsLib> {
  if (pdfjsModule) {
    pdfjsModule.GlobalWorkerOptions.workerPort = pdfWorkerPort();
    return pdfjsModule;
  }
  const mod = (await import("pdfjs-dist")) as unknown as PdfjsLib;
  mod.GlobalWorkerOptions.workerPort = pdfWorkerPort();
  pdfjsModule = mod;
  return mod;
}
