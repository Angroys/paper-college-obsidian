import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";
import { PLUGIN_COPY } from "./copy";
import type { SyncPaper } from "./types";

export class PaperPickerModal extends FuzzySuggestModal<SyncPaper> {
  constructor(
    app: App,
    private readonly papers: SyncPaper[],
    private readonly onPick: (paper: SyncPaper) => void,
  ) {
    super(app);
    this.setPlaceholder(PLUGIN_COPY.pickerSearch);
  }

  getItems(): SyncPaper[] {
    return this.papers;
  }

  getItemText(paper: SyncPaper): string {
    const title = paper.title?.trim();
    return title ? title : PLUGIN_COPY.pickerUntitled;
  }

  onChooseItem(paper: SyncPaper): void {
    this.onPick(paper);
  }
}

export class EmptyPaperPickerModal extends Modal {
  constructor(
    app: App,
    private readonly onSync: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(PLUGIN_COPY.pickerTitle);
    contentEl.createEl("p", {
      cls: "paper-modal-body",
      text: PLUGIN_COPY.pickerEmpty,
    });
    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText(PLUGIN_COPY.cancel);
        btn.onClick(() => this.close());
      })
      .addButton((btn) => {
        btn.setButtonText(PLUGIN_COPY.syncNow);
        btn.onClick(() => {
          this.close();
          this.onSync();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
