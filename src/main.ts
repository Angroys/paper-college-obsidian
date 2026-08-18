import {
  normalizePath,
  Notice,
  Plugin,
  TFile,
  TFolder,
} from "obsidian";
import { fetchSyncPayload } from "./api";
import { paperIdFromCanvasEvent } from "./canvas-open";
import {
  formatRelativeTime,
  PLUGIN_COPY,
  statusBarText,
  syncPartialNotice,
  syncSuccessNotice,
} from "./copy";
import { ConfirmModal } from "./modals";
import { ObsidianVaultWriter } from "./obsidian-vault";
import { exchangeErrorMessage, exchangePairingCode } from "./pairing";
import { PaperPdfView } from "./pdf-view";
import { releasePdfWorker } from "./pdf-worker";
import { EmptyPaperPickerModal, PaperPickerModal } from "./picker";
import { obsidianFetch } from "./request";
import { PaperSettingTab } from "./settings-tab";
import { applyPlan, buildApplyPlan, CANVAS_FILENAME, joinVaultPath } from "./sync-apply";
import {
  DEFAULT_SETTINGS,
  type PaperPluginSettings,
  type SyncPaper,
} from "./types";
import {
  normalizeBaseUrl,
  parsePaperIdFromLibraryUrl,
  parsePaperIdFromProtocol,
  PDF_PROTOCOL_ACTION,
  PDF_VIEW_TYPE,
  settingsDeepLink,
} from "./urls";

export default class PaperPlugin extends Plugin {
  settings: PaperPluginSettings = { ...DEFAULT_SETTINGS };
  pendingCode = "";
  connectError = "";
  syncing = false;
  private statusBar: HTMLElement | null = null;
  private syncError = false;
  private hookedCanvasEls = new WeakSet<HTMLElement>();

  isConnected(): boolean {
    return this.settings.token.length > 0;
  }

  settingsDeepLink(): string {
    return settingsDeepLink(this.settings.baseUrl);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.settings.baseUrl = normalizeBaseUrl(this.settings.baseUrl);
    this.settings.syncOnStartup = Boolean(this.settings.syncOnStartup);

    this.registerView(PDF_VIEW_TYPE, (leaf) => {
      return new PaperPdfView(leaf, {
        getToken: () => this.settings.token,
        getBaseUrl: () => this.settings.baseUrl,
        openConnect: () => this.openConnect(),
      });
    });
    this.register(() => releasePdfWorker());

    this.registerObsidianProtocolHandler(PDF_PROTOCOL_ACTION, (params) => {
      const paperId = typeof params.paperId === "string" ? params.paperId : "";
      if (!paperId) {
        return;
      }
      void this.openPdf(paperId);
    });

    this.addRibbonIcon("book-open", PLUGIN_COPY.syncNow, () => {
      if (this.syncing) {
        return;
      }
      if (!this.isConnected()) {
        this.openSettings();
        return;
      }
      void this.syncNow();
    });

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("paper-status");
    this.registerDomEvent(this.statusBar, "click", () => this.openSettings());
    this.refreshStatusBar();

    this.addCommand({
      id: "connect",
      name: PLUGIN_COPY.commandConnect,
      callback: () => this.openConnect(),
    });
    this.addCommand({
      id: "sync",
      name: PLUGIN_COPY.commandSync,
      callback: () => {
        if (!this.isConnected()) {
          this.openConnect();
          return;
        }
        void this.syncNow();
      },
    });
    this.addCommand({
      id: "open-pdf",
      name: PLUGIN_COPY.commandOpenPdf,
      callback: () => {
        if (!this.isConnected()) {
          this.openConnect();
          return;
        }
        this.openPdfPicker();
      },
    });
    this.addCommand({
      id: "open-folder",
      name: PLUGIN_COPY.commandOpenFolder,
      callback: () => {
        if (!this.isConnected()) {
          this.openConnect();
          return;
        }
        void this.openPaperFolder();
      },
    });
    this.addCommand({
      id: "disconnect",
      name: PLUGIN_COPY.commandDisconnect,
      callback: () => {
        if (!this.isConnected()) {
          this.openConnect();
          return;
        }
        this.confirmDisconnect();
      },
    });

    this.addSettingTab(new PaperSettingTab(this.app, this));
    this.registerCanvasHandlers();
    this.registerMarkdownPdfLinks();

    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.firstRunDismissed) {
        this.settings.firstRunDismissed = true;
        void this.saveSettings();
        this.showFirstRunNotice();
      }

      if (this.settings.syncOnStartup && this.isConnected()) {
        void this.syncNow({ quiet: true });
      }
    });
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<PaperPluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  startConnect(): void {
    if (this.isConnected()) {
      this.openSettings();
      return;
    }
    const url = this.settingsDeepLink();
    window.open(url);
    this.openSettings();
    new Notice(`${PLUGIN_COPY.connectionManualUrl} ${url}`);
  }

  openConnect(): void {
    if (this.isConnected()) {
      this.openSettings();
      return;
    }
    this.startConnect();
  }

  async exchangePendingCode(): Promise<void> {
    this.connectError = "";
    const vaultName = this.app.vault.getName();
    const result = await exchangePairingCode(
      obsidianFetch,
      this.settings.baseUrl,
      this.pendingCode,
      vaultName,
    );
    if (!result.ok) {
      this.connectError = exchangeErrorMessage(result.kind);
      new Notice(this.connectError);
      this.openSettings();
      return;
    }
    this.settings.token = result.token;
    this.settings.deviceId = result.deviceId;
    this.settings.accountLabel = result.accountLabel;
    this.pendingCode = "";
    await this.saveSettings();
    new Notice(PLUGIN_COPY.connectOfferSync);
    this.openSettings();
  }

  confirmDisconnect(): void {
    new ConfirmModal(this.app, {
      title: PLUGIN_COPY.disconnectTitle,
      body: PLUGIN_COPY.disconnectBody,
      confirm: PLUGIN_COPY.disconnectConfirm,
      onConfirm: async () => {
        this.settings.token = "";
        this.settings.deviceId = "";
        this.settings.accountLabel = "";
        await this.saveSettings();
        this.refreshStatusBar();
      },
    }).open();
  }

  confirmReplaceConnection(): void {
    new ConfirmModal(this.app, {
      title: PLUGIN_COPY.connectionReplaceTitle,
      body: PLUGIN_COPY.connectionReplaceBody,
      confirm: PLUGIN_COPY.connectionReplaceConfirm,
      onConfirm: async () => {
        this.settings.token = "";
        this.settings.deviceId = "";
        this.settings.accountLabel = "";
        await this.saveSettings();
        this.startConnect();
      },
    }).open();
  }

  async syncNow(opts?: { quiet?: boolean }): Promise<void> {
    if (this.syncing) {
      return;
    }
    if (!this.isConnected()) {
      this.openConnect();
      return;
    }
    if (!navigator.onLine) {
      this.syncError = true;
      this.refreshStatusBar();
      new Notice(PLUGIN_COPY.offline);
      return;
    }

    this.syncing = true;
    this.syncError = false;
    this.refreshStatusBar();

    const fetched = await fetchSyncPayload(
      obsidianFetch,
      this.settings.baseUrl,
      this.settings.token,
    );

    if (!fetched.ok) {
      this.syncing = false;
      if (fetched.kind === "auth") {
        new Notice(PLUGIN_COPY.pdfErrorAuth);
        this.openConnect();
        this.refreshStatusBar();
        return;
      }
      this.syncError = true;
      this.refreshStatusBar();
      new Notice(
        fetched.kind === "offline" ? PLUGIN_COPY.offline : PLUGIN_COPY.noticeSyncError,
      );
      return;
    }

    const plan = buildApplyPlan(fetched.payload, this.settings.folder);
    const writer = new ObsidianVaultWriter(this.app.vault);
    const applied = await applyPlan(writer, plan);

    this.syncing = false;
    this.settings.lastPapers = fetched.payload.papers.map((p) => ({
      id: p.id,
      title: p.title,
    }));
    this.settings.lastTermCount = plan.termCount;
    this.settings.lastPaperCount = plan.paperCount;
    this.settings.lastCanvasOk = applied.canvasOk;
    this.settings.lastSyncError = applied.folderError;

    const allOk =
      applied.folderError == null &&
      applied.failed.length === 0 &&
      applied.glossaryOk &&
      applied.canvasOk &&
      applied.papersOk &&
      !plan.glossaryAborted &&
      !plan.canvasAborted &&
      !plan.papersAborted;

    if (applied.folderError) {
      this.syncError = true;
      this.refreshStatusBar();
      new Notice(applied.folderError);
      return;
    }

    if (allOk) {
      this.settings.lastSyncAt = new Date().toISOString();
      const first = !this.settings.firstSyncDone;
      this.settings.firstSyncDone = true;
      await this.saveSettings();
      this.refreshStatusBar();
      if (!opts?.quiet) {
        if (plan.emptyGlossary) {
          const extra = first
            ? ` ${syncSuccessNotice(0, plan.paperCount, true)}`
            : "";
          new Notice(`${PLUGIN_COPY.noticeSyncEmpty}${first ? extra : ""}`.trim());
        } else {
          new Notice(
            syncSuccessNotice(plan.termCount, plan.paperCount, first),
          );
        }
      }
      return;
    }

    this.syncError = true;
    await this.saveSettings();
    this.refreshStatusBar();
    const failedPart = !applied.canvasOk
      ? PLUGIN_COPY.failedPartMindmap
      : !applied.glossaryOk
        ? PLUGIN_COPY.failedPartGlossary
        : PLUGIN_COPY.failedPartGlossary;
    new Notice(syncPartialNotice(failedPart));
  }

  openPdfPicker(): void {
    const papers = this.settings.lastPapers;
    if (!papers || papers.length === 0) {
      new EmptyPaperPickerModal(this.app, () => {
        void this.syncNow();
      }).open();
      return;
    }
    new PaperPickerModal(this.app, papers, (paper) => {
      void this.openPdf(paper.id, paper.title);
    }).open();
  }

  async openPdf(paperId: string, title?: string): Promise<void> {
    if (!this.isConnected()) {
      this.openConnect();
      return;
    }
    const known: SyncPaper | undefined = this.settings.lastPapers.find(
      (p) => p.id === paperId,
    );
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: PDF_VIEW_TYPE,
      active: true,
      state: {
        paperId,
        title: title || known?.title || PLUGIN_COPY.pickerUntitled,
      },
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openPaperFolder(): Promise<void> {
    const folderPath = normalizePath(this.settings.folder);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      const canvas = this.app.vault.getAbstractFileByPath(
        normalizePath(joinVaultPath(folderPath, CANVAS_FILENAME)),
      );
      if (canvas instanceof TFile) {
        await this.app.workspace.getLeaf().openFile(canvas);
        return;
      }
    }
    new Notice(PLUGIN_COPY.folderError);
  }

  openSettings(): void {
    const setting = (
      this.app as unknown as {
        setting?: { open: () => void; openTabById: (id: string) => void };
      }
    ).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  private refreshStatusBar(): void {
    if (!this.statusBar) {
      return;
    }
    if (this.syncing) {
      this.statusBar.setText(statusBarText(PLUGIN_COPY.statusSyncing));
      return;
    }
    if (this.syncError) {
      this.statusBar.setText(statusBarText(PLUGIN_COPY.statusError));
      return;
    }
    if (!this.settings.lastSyncAt) {
      this.statusBar.setText(statusBarText(PLUGIN_COPY.statusNever));
      return;
    }
    this.statusBar.setText(
      statusBarText(formatRelativeTime(this.settings.lastSyncAt)),
    );
  }

  private showFirstRunNotice(): void {
    const notice = new Notice("", 0);
    notice.messageEl.empty();
    notice.messageEl.createSpan({ text: PLUGIN_COPY.noticeFirstRun });
    const actions = notice.messageEl.createDiv({ cls: "paper-notice-actions" });
    const connect = actions.createEl("button", {
      text: PLUGIN_COPY.connect,
      attr: { type: "button" },
    });
    const dismiss = actions.createEl("button", {
      text: PLUGIN_COPY.noticeFirstRunDismiss,
      attr: { type: "button" },
    });
    connect.addEventListener("click", () => {
      notice.hide();
      this.startConnect();
    });
    dismiss.addEventListener("click", () => {
      notice.hide();
    });
  }

  private registerMarkdownPdfLinks(): void {
    this.registerDomEvent(document, "click", (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest("a");
      if (!anchor) {
        return;
      }
      const href =
        anchor.getAttribute("href") ||
        anchor.getAttribute("data-href") ||
        "";
      if (!href.includes(PDF_PROTOCOL_ACTION) && !href.includes("/library/")) {
        return;
      }
      const paperId =
        parsePaperIdFromProtocol(href) || parsePaperIdFromLibraryUrl(href);
      if (!paperId) {
        return;
      }
      event.preventDefault();
      void this.openPdf(paperId);
    });
  }

  private registerCanvasHandlers(): void {
    const activate = async (event: Event) => {
      const canvasLeaves = this.app.workspace.getLeavesOfType("canvas");
      for (const canvasLeaf of canvasLeaves) {
        const view = canvasLeaf.view as unknown as {
          file?: { path: string };
          canvas?: unknown;
          containerEl?: HTMLElement;
        };
        if (!view.containerEl?.contains(event.target as Node)) {
          continue;
        }
        let doc: { nodes?: unknown[] } | null = null;
        if (view.file?.path) {
          const file = this.app.vault.getAbstractFileByPath(
            normalizePath(view.file.path),
          );
          if (file instanceof TFile) {
            try {
              const raw = await this.app.vault.read(file);
              doc = JSON.parse(raw) as { nodes?: unknown[] };
            } catch {
              doc = null;
            }
          }
        }
        const paperId = paperIdFromCanvasEvent(view as never, event, doc);
        if (paperId) {
          event.preventDefault();
          event.stopPropagation();
          void this.openPdf(paperId);
        }
      }
    };

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
          const el = leaf.view.containerEl;
          if (this.hookedCanvasEls.has(el)) {
            continue;
          }
          this.hookedCanvasEls.add(el);
          this.registerDomEvent(el, "dblclick", (ev) => {
            void activate(ev);
          });
          this.registerDomEvent(el, "click", (ev) => {
            const target = ev.target;
            if (target instanceof Element && target.closest("a")) {
              void activate(ev);
            }
          });
        }
      }),
    );
  }
}
