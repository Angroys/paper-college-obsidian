import { Modal, Setting, type App } from "obsidian";
import { PLUGIN_COPY } from "./copy";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      title: string;
      body: string;
      confirm: string;
      onConfirm: () => void | Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(this.options.title);
    contentEl.createEl("p", {
      cls: "paper-modal-body",
      text: this.options.body,
    });

    const buttons = contentEl.createDiv({ cls: "paper-confirm-buttons" });
    let confirmed = false;

    new Setting(buttons)
      .addButton((btn) => {
        btn.setButtonText(PLUGIN_COPY.cancel);
        btn.setCta();
        btn.buttonEl.focus();
        btn.onClick(() => this.close());
      })
      .addButton((btn) => {
        btn.setButtonText(this.options.confirm);
        btn.onClick(async () => {
          if (confirmed) {
            return;
          }
          confirmed = true;
          await this.options.onConfirm();
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
