import { PluginSettingTab, Setting, type App } from "obsidian";
import { CanvasLayoutSection } from "./canvas-settings";
import { connectedAs, PLUGIN_COPY } from "./copy";
import type PaperPlugin from "./main";
import { normalizeBaseUrl } from "./urls";
import { normalizeFolderName } from "./sync-apply";

export class PaperSettingTab extends PluginSettingTab {
  private readonly canvasSection: CanvasLayoutSection;

  constructor(
    app: App,
    private readonly plugin: PaperPlugin,
  ) {
    super(app, plugin);
    this.canvasSection = new CanvasLayoutSection(plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const connected = this.plugin.isConnected();
    const settings = this.plugin.settings;

    new Setting(containerEl).setName(PLUGIN_COPY.connectionTitle).setHeading();
    if (connected) {
      containerEl.createEl("p", {
        cls: "paper-setting-note",
        text: connectedAs(settings.accountLabel || settings.deviceId),
      });
      new Setting(containerEl)
        .setName(PLUGIN_COPY.syncNow)
        .addButton((btn) => {
          btn.setButtonText(PLUGIN_COPY.syncNow);
          btn.onClick(() => {
            void this.plugin.syncNow();
          });
        });
      new Setting(containerEl)
        .setName(PLUGIN_COPY.disconnect)
        .addButton((btn) => {
          btn.setButtonText(PLUGIN_COPY.disconnect);
          btn.onClick(() => this.plugin.confirmDisconnect());
        });
      new Setting(containerEl)
        .setName(PLUGIN_COPY.connectionReplace)
        .setDesc(PLUGIN_COPY.connectionReplaceBody)
        .addButton((btn) => {
          btn.setButtonText(PLUGIN_COPY.connectionReplace);
          btn.onClick(() => this.plugin.confirmReplaceConnection());
        });
    } else {
      containerEl.createEl("p", {
        cls: "paper-setting-note",
        text: PLUGIN_COPY.connectionDisconnected,
      });
      new Setting(containerEl)
        .setName(PLUGIN_COPY.connect)
        .addButton((btn) => {
          btn.setButtonText(PLUGIN_COPY.connect);
          btn.onClick(() => this.plugin.startConnect());
        });
      const url = this.plugin.settingsDeepLink();
      new Setting(containerEl)
        .setName(PLUGIN_COPY.connectionManualUrl)
        .setDesc(url)
        .addButton((btn) => {
          btn.setButtonText("Copy");
          btn.onClick(async () => {
            await navigator.clipboard.writeText(url);
            btn.setButtonText(PLUGIN_COPY.copied);
          });
        });
      new Setting(containerEl)
        .setName(PLUGIN_COPY.connectionCodeLabel)
        .setDesc(PLUGIN_COPY.connectionCodeHelp)
        .addText((text) => {
          text.setPlaceholder("48219307");
          text.inputEl.setAttribute("inputmode", "numeric");
          text.inputEl.setAttribute("pattern", "[0-9]*");
          text.onChange((value) => {
            this.plugin.pendingCode = value;
          });
        })
        .addButton((btn) => {
          btn.setButtonText(PLUGIN_COPY.connect);
          btn.onClick(() => {
            void this.plugin.exchangePendingCode();
          });
        });
      if (this.plugin.connectError) {
        containerEl.createEl("p", {
          cls: "paper-setting-note paper-setting-error",
          text: this.plugin.connectError,
          attr: { role: "alert" },
        });
      }
    }

    new Setting(containerEl).setName(PLUGIN_COPY.folderTitle).setHeading();
    new Setting(containerEl)
      .setName(PLUGIN_COPY.folderTitle)
      .setDesc(PLUGIN_COPY.folderHelp)
      .addText((text) => {
        text.setValue(settings.folder);
        text.setDisabled(this.plugin.syncing);
        text.onChange(async (value) => {
          this.plugin.settings.folder = normalizeFolderName(value);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(PLUGIN_COPY.syncTitle).setHeading();
    new Setting(containerEl)
      .setName(PLUGIN_COPY.syncNow)
      .setDesc(connected ? "" : PLUGIN_COPY.syncDisabledHelp)
      .addButton((btn) => {
        btn.setButtonText(PLUGIN_COPY.syncNow);
        btn.setDisabled(!connected);
        btn.onClick(() => {
          void this.plugin.syncNow();
        });
      });
    new Setting(containerEl)
      .setName(PLUGIN_COPY.syncStartup)
      .addToggle((toggle) => {
        toggle.setValue(settings.syncOnStartup);
        toggle.onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        });
      });
    containerEl.createEl("p", {
      cls: "paper-setting-note",
      text: PLUGIN_COPY.overwriteDisclosure,
    });

    this.canvasSection.render(containerEl.createDiv());

    new Setting(containerEl).setName(PLUGIN_COPY.pdfTitle).setHeading();
    containerEl.createEl("p", {
      cls: "paper-setting-note",
      text: PLUGIN_COPY.pdfPolicy,
    });

    new Setting(containerEl)
      .setName(PLUGIN_COPY.siteUrlTitle)
      .setDesc(PLUGIN_COPY.siteUrlHelp)
      .addText((text) => {
        text.setValue(settings.baseUrl);
        text.onChange(async (value) => {
          this.plugin.settings.baseUrl = normalizeBaseUrl(value);
          await this.plugin.saveSettings();
        });
      });
  }
}
