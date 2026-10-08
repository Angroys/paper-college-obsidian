/**
 * Settings tab "Canvas layout" section: preset picker, a collapsible editor
 * for every `CanvasPreset` option, reset / re-sync buttons, and a live
 * preview (scaled drawing or outline + raw JSON) built from the cached sync
 * payload. Every edit is saved through `plugin.updateCanvasPresets` and the
 * preview refreshes straight away (text inputs are debounced).
 */

import { debounce, Setting, type DropdownComponent } from "obsidian";
import { serializeCanvas } from "./canvas/generate";
import { buildOutline, buildPreviewModel } from "./canvas/preview";
import { renderOutline, renderPreviewDrawing } from "./canvas/preview-dom";
import {
  isCanvasColor,
  listPresets,
  resetPreset,
  resolvePreset,
  savePreset,
  setActivePreset,
} from "./canvas/store";
import {
  CANVAS_LEVELS,
  STYLED_KINDS,
  type CanvasLevel,
  type CanvasPreset,
  type GeneratedCanvas,
  type KindSize,
} from "./canvas/types";
import {
  CANVAS_COLOR_PRESET_LABELS,
  CANVAS_KIND_LABELS,
  CANVAS_LEVEL_LABELS,
  CANVAS_OPTION_LABELS,
  CANVAS_SETTINGS_COPY as C,
  canvasLevelColorLabel,
  canvasPreviewSummary,
} from "./copy";
import type PaperPlugin from "./main";

const TEXT_DEBOUNCE_MS = 400;
const CUSTOM_COLOR = "custom";
const DEFAULT_CUSTOM_HEX = "#4f46e5";

type PreviewMode = "drawing" | "outline";
type Options = Readonly<Record<string, string>>;

const EMIT_LABELS: Record<CanvasLevel, string> = {
  overview: C.emitOverview,
  project: C.emitProject,
  paper: C.emitPaper,
  term: C.emitTerm,
};

export class CanvasLayoutSection {
  /** Collapsible sections the user opened; kept across re-renders. */
  private readonly openSections = new Set<string>();
  private draft: CanvasPreset;
  private root: HTMLElement | null = null;
  private previewPath: string | null = null;
  private previewMode: PreviewMode = "drawing";
  private rawJson = false;
  private resetButton: { setDisabled(disabled: boolean): unknown } | null = null;
  private editedBadge: HTMLElement | null = null;
  private preview: {
    fileDropdown: DropdownComponent;
    summary: HTMLElement;
    empty: HTMLElement;
    drawing: HTMLElement;
    outline: HTMLElement;
    raw: HTMLElement;
  } | null = null;

  private readonly commitSoon = debounce(() => void this.commit(), TEXT_DEBOUNCE_MS, true);

  constructor(private readonly plugin: PaperPlugin) {
    this.draft = plugin.activeCanvasPreset();
  }

  /** Renders the whole section into `root` (cleared first). */
  render(root: HTMLElement): void {
    this.root = root;
    root.empty();
    root.addClass("paper-canvas-settings");
    this.draft = this.plugin.activeCanvasPreset();
    const store = this.plugin.settings.canvasPresets;

    new Setting(root).setName(C.title).setHeading();
    root.createEl("p", { cls: "paper-setting-note", text: C.intro });

    new Setting(root)
      .setName(C.preset)
      .setDesc(this.draft.description)
      .addDropdown((dd) => {
        for (const preset of listPresets(store)) {
          dd.addOption(preset.id, preset.name);
        }
        dd.setValue(store.activePresetId);
        dd.onChange(async (id) => {
          await this.plugin.updateCanvasPresets(setActivePreset(this.plugin.settings.canvasPresets, id));
          this.rerender();
        });
      });

    new Setting(root)
      .setName(C.reset)
      .setDesc(C.resetDesc)
      .addButton((btn) => {
        this.resetButton = btn;
        btn.setButtonText(C.reset);
        btn.setDisabled(!this.isEdited());
        btn.onClick(async () => {
          const current = this.plugin.settings.canvasPresets;
          await this.plugin.updateCanvasPresets(resetPreset(current, current.activePresetId));
          this.rerender();
        });
      });

    new Setting(root)
      .setName(C.resync)
      .setDesc(C.resyncDesc)
      .addButton((btn) => {
        btn.setButtonText(this.plugin.syncing ? C.resyncBusy : C.resync);
        btn.setCta();
        btn.setDisabled(this.plugin.syncing);
        btn.onClick(async () => {
          if (this.plugin.syncing) {
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText(C.resyncBusy);
          try {
            await this.plugin.resyncCanvases();
          } finally {
            btn.setDisabled(this.plugin.syncing);
            btn.setButtonText(C.resync);
          }
        });
      });

    this.renderEditor(root);
    this.renderPreview(root);
    this.refreshPreview();
  }

  private rerender(): void {
    if (this.root) {
      this.render(this.root);
    }
  }

  private isEdited(): boolean {
    const store = this.plugin.settings.canvasPresets;
    return Boolean(store.overrides[store.activePresetId]);
  }

  /**
   * Saves the draft as the active preset's edit and refreshes the preview.
   * The draft is swapped for the sanitised copy synchronously, so edits made
   * while the save is in flight land on the new draft and are not lost.
   */
  private async commit(): Promise<void> {
    const next = savePreset(this.plugin.settings.canvasPresets, this.draft);
    this.draft = resolvePreset(next);
    const saving = this.plugin.updateCanvasPresets(next);
    this.resetButton?.setDisabled(!this.isEdited());
    this.editedBadge?.toggleClass("paper-is-hidden", !this.isEdited());
    this.refreshPreview();
    await saving;
  }

  // --- Editor ---------------------------------------------------------------------

  private section(parent: HTMLElement, key: string, title: string): HTMLElement {
    const details = parent.createEl("details", { cls: "paper-canvas-editor-section" });
    details.open = this.openSections.has(key);
    details.createEl("summary", { text: title });
    details.addEventListener("toggle", () => {
      if (details.open) this.openSections.add(key);
      else this.openSections.delete(key);
    });
    return details.createDiv({ cls: "paper-canvas-editor-body" });
  }

  private renderEditor(root: HTMLElement): void {
    const editor = root.createEl("details", { cls: "paper-canvas-editor" });
    editor.open = this.openSections.has("editor");
    const summary = editor.createEl("summary", { text: C.edit });
    this.editedBadge = summary.createSpan({ cls: "paper-canvas-edited", text: C.edited });
    this.editedBadge.toggleClass("paper-is-hidden", !this.isEdited());
    editor.addEventListener("toggle", () => {
      if (editor.open) this.openSections.add("editor");
      else this.openSections.delete("editor");
    });
    const body = editor.createDiv({ cls: "paper-canvas-editor-body" });
    const d = () => this.draft;

    // Name and description
    const details = this.section(body, "details", C.details);
    this.text(details, C.name, "", () => d().name, (v) => (d().name = v));
    this.text(details, C.description, "", () => d().description, (v) => (d().description = v));

    // Structure
    const st = this.section(body, "structure", C.structure);
    this.dropdown(st, C.root, C.rootDesc, CANVAS_OPTION_LABELS.root, () => d().structure.root, (v) => {
      d().structure.root = v as CanvasPreset["structure"]["root"];
    });
    this.dropdown(st, C.depth, C.depthDesc, CANVAS_OPTION_LABELS.depth, () => String(d().structure.depth), (v) => {
      d().structure.depth = v === "2" ? 2 : 3;
    });
    new Setting(st).setName(C.emitTitle).setHeading();
    for (const level of CANVAS_LEVELS) {
      this.toggle(st, EMIT_LABELS[level], "", () => d().structure.emit[level], (v) => (d().structure.emit[level] = v));
    }
    this.dropdown(st, C.unassigned, "", CANVAS_OPTION_LABELS.unassigned, () => d().structure.unassigned, (v) => {
      d().structure.unassigned = v as CanvasPreset["structure"]["unassigned"];
    });

    // Grouping
    const gr = this.section(body, "grouping", C.grouping);
    const cluster = CANVAS_OPTION_LABELS.cluster;
    type Cluster = CanvasPreset["grouping"]["terms"];
    this.dropdown(gr, C.groupTerms, "", cluster, () => d().grouping.terms, (v) => (d().grouping.terms = v as Cluster));
    this.dropdown(gr, C.groupHighlights, "", cluster, () => d().grouping.highlights, (v) => (d().grouping.highlights = v as Cluster));
    this.dropdown(gr, C.groupNotes, "", cluster, () => d().grouping.notes, (v) => (d().grouping.notes = v as Cluster));
    this.dropdown(gr, C.projectTerms, "", CANVAS_OPTION_LABELS.projectTerms, () => d().grouping.projectTerms, (v) => {
      d().grouping.projectTerms = v as CanvasPreset["grouping"]["projectTerms"];
    });
    this.dropdown(gr, C.sort, "", CANVAS_OPTION_LABELS.sort, () => d().grouping.sort, (v) => {
      d().grouping.sort = v as CanvasPreset["grouping"]["sort"];
    });
    this.number(gr, C.maxTerms, C.capDesc, () => d().grouping.maxTerms, (v) => (d().grouping.maxTerms = v));
    this.number(gr, C.maxHighlights, C.capDesc, () => d().grouping.maxHighlights, (v) => (d().grouping.maxHighlights = v));

    // Layout
    const la = this.section(body, "layout", C.layout);
    this.dropdown(la, C.algorithm, "", CANVAS_OPTION_LABELS.algorithm, () => d().layout.algorithm, (v) => {
      d().layout.algorithm = v as CanvasPreset["layout"]["algorithm"];
    });
    this.number(la, C.siblingGap, "", () => d().layout.siblingGap, (v) => (d().layout.siblingGap = v));
    this.number(la, C.levelGap, "", () => d().layout.levelGap, (v) => (d().layout.levelGap = v));
    this.number(la, C.groupPadding, "", () => d().layout.groupPadding, (v) => (d().layout.groupPadding = v));
    this.number(la, C.groupColumns, "", () => d().layout.groupColumns, (v) => (d().layout.groupColumns = v));
    this.number(la, C.gridColumns, C.gridColumnsDesc, () => d().layout.gridColumns, (v) => (d().layout.gridColumns = v));
    this.dropdown(la, C.sizing, "", CANVAS_OPTION_LABELS.sizing, () => d().layout.sizing, (v) => {
      d().layout.sizing = v as CanvasPreset["layout"]["sizing"];
    });
    this.number(la, C.maxLines, C.maxLinesDesc, () => d().layout.maxLines, (v) => (d().layout.maxLines = v));
    new Setting(la).setName(C.sizesTitle).setDesc(C.sizesDesc).setHeading();
    for (const kind of STYLED_KINDS) {
      this.sizeRow(la, CANVAS_KIND_LABELS[kind], () => d().layout.sizes[kind]);
    }

    // Connections
    const co = this.section(body, "connections", C.connections);
    this.toggle(co, C.siblings, C.siblingsDesc, () => d().connections.siblings, (v) => (d().connections.siblings = v));
    this.toggle(co, C.backlinks, C.backlinksDesc, () => d().connections.backlinks, (v) => (d().connections.backlinks = v));
    this.dropdown(co, C.arrow, "", CANVAS_OPTION_LABELS.arrow, () => d().connections.arrow, (v) => {
      d().connections.arrow = v as CanvasPreset["connections"]["arrow"];
    });
    this.dropdown(co, C.sides, "", CANVAS_OPTION_LABELS.sides, () => d().connections.sides, (v) => {
      d().connections.sides = v as CanvasPreset["connections"]["sides"];
    });
    co.createEl("p", { cls: "paper-setting-note", text: C.noLabels });

    // Look
    const lo = this.section(body, "look", C.look);
    this.dropdown(lo, C.colorMode, "", CANVAS_OPTION_LABELS.colorMode, () => d().look.colorMode, (v) => {
      d().look.colorMode = v as CanvasPreset["look"]["colorMode"];
    });
    new Setting(lo).setName(C.kindColorsTitle).setHeading();
    for (const kind of STYLED_KINDS) {
      this.color(lo, CANVAS_KIND_LABELS[kind], () => d().look.kindColors[kind], (v) => (d().look.kindColors[kind] = v));
    }
    new Setting(lo).setName(C.levelColorsTitle).setHeading();
    for (const level of [0, 1, 2, 3] as const) {
      this.color(lo, canvasLevelColorLabel(level), () => d().look.levelColors[level], (v) => (d().look.levelColors[level] = v));
    }
    this.dropdown(lo, C.hubText, "", CANVAS_OPTION_LABELS.hubText, () => d().look.hubText, (v) => {
      d().look.hubText = v as CanvasPreset["look"]["hubText"];
    });
    this.dropdown(lo, C.termText, "", CANVAS_OPTION_LABELS.termText, () => d().look.termText, (v) => {
      d().look.termText = v as CanvasPreset["look"]["termText"];
    });
    this.dropdown(lo, C.highlightText, "", CANVAS_OPTION_LABELS.highlightText, () => d().look.highlightText, (v) => {
      d().look.highlightText = v as CanvasPreset["look"]["highlightText"];
    });

    // File links
    const fi = this.section(body, "files", C.files);
    new Setting(fi).setName(C.noteNodesTitle).setDesc(C.noteNodesDesc).setHeading();
    for (const level of CANVAS_LEVELS) {
      this.toggle(fi, CANVAS_LEVEL_LABELS[level], "", () => d().files.noteNodes[level], (v) => (d().files.noteNodes[level] = v));
    }
    type Entity = CanvasPreset["files"]["paperNode"];
    this.dropdown(fi, C.paperNode, "", CANVAS_OPTION_LABELS.entityNode, () => d().files.paperNode, (v) => (d().files.paperNode = v as Entity));
    this.dropdown(fi, C.termNode, "", CANVAS_OPTION_LABELS.entityNode, () => d().files.termNode, (v) => (d().files.termNode = v as Entity));
    this.toggle(fi, C.backlinkToParent, "", () => d().files.backlinkToParent, (v) => (d().files.backlinkToParent = v));
    this.dropdown(fi, C.paperFolders, "", CANVAS_OPTION_LABELS.paperFolders, () => d().files.paperFolders, (v) => {
      d().files.paperFolders = v as CanvasPreset["files"]["paperFolders"];
    });

    // Custom CSS
    const css = this.section(body, "css", C.css);
    css.createEl("p", { cls: "paper-setting-note", text: C.cssDesc });
    const area = css.createEl("textarea", {
      cls: "paper-canvas-css",
      attr: { rows: "12", spellcheck: "false", "aria-label": C.css, placeholder: C.cssPlaceholder },
    });
    area.value = d().css;
    area.addEventListener("input", () => {
      this.draft.css = area.value;
      this.commitSoon();
    });
  }

  // --- Controls -------------------------------------------------------------------

  private dropdown(
    parent: HTMLElement,
    name: string,
    desc: string,
    options: Options,
    get: () => string,
    set: (value: string) => void,
  ): void {
    new Setting(parent)
      .setName(name)
      .setDesc(desc)
      .addDropdown((dd) => {
        dd.addOptions(options);
        dd.setValue(get());
        dd.onChange((value) => {
          set(value);
          void this.commit();
        });
      });
  }

  private toggle(
    parent: HTMLElement,
    name: string,
    desc: string,
    get: () => boolean,
    set: (value: boolean) => void,
  ): void {
    new Setting(parent)
      .setName(name)
      .setDesc(desc)
      .addToggle((t) => {
        t.setValue(get());
        t.onChange((value) => {
          set(value);
          void this.commit();
        });
      });
  }

  private text(
    parent: HTMLElement,
    name: string,
    desc: string,
    get: () => string,
    set: (value: string) => void,
  ): void {
    new Setting(parent)
      .setName(name)
      .setDesc(desc)
      .addText((t) => {
        t.setValue(get());
        t.onChange((value) => {
          set(value);
          this.commitSoon();
        });
        t.inputEl.addEventListener("blur", () => {
          this.commitSoon.run();
          t.setValue(get());
        });
      });
  }

  private number(
    parent: HTMLElement,
    name: string,
    desc: string,
    get: () => number,
    set: (value: number) => void,
  ): void {
    new Setting(parent)
      .setName(name)
      .setDesc(desc)
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("paper-canvas-number");
        t.setValue(String(get()));
        t.onChange((value) => {
          const n = Number(value);
          if (value.trim() === "" || !Number.isFinite(n)) return;
          set(n);
          this.commitSoon();
        });
        t.inputEl.addEventListener("blur", () => {
          this.commitSoon.run();
          t.setValue(String(get()));
        });
      });
  }

  /** Four number inputs (min/max width/height) for one kind's card size. */
  private sizeRow(parent: HTMLElement, name: string, get: () => KindSize): void {
    const setting = new Setting(parent).setName(name);
    setting.controlEl.addClass("paper-canvas-size-row");
    const fields: Array<[keyof KindSize, string]> = [
      ["minWidth", C.minWidth],
      ["maxWidth", C.maxWidth],
      ["minHeight", C.minHeight],
      ["maxHeight", C.maxHeight],
    ];
    for (const [key, label] of fields) {
      setting.addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("paper-canvas-number");
        t.inputEl.setAttribute("aria-label", `${name}: ${label}`);
        t.inputEl.setAttribute("title", label);
        t.setPlaceholder(label);
        t.setValue(String(get()[key]));
        t.onChange((value) => {
          const n = Number(value);
          if (value.trim() === "" || !Number.isFinite(n)) return;
          get()[key] = n;
          this.commitSoon();
        });
        t.inputEl.addEventListener("blur", () => {
          this.commitSoon.run();
          t.setValue(String(get()[key]));
        });
      });
    }
  }

  /** Obsidian preset colour (1–6) or a custom hex with a colour picker. */
  private color(parent: HTMLElement, name: string, get: () => string, set: (value: string) => void): void {
    const setting = new Setting(parent).setName(name);
    const current = get();
    const isPreset = current.length === 1;
    let lastHex = isPreset ? DEFAULT_CUSTOM_HEX : current;
    let picker: { setValue(v: string): unknown; setDisabled(d: boolean): unknown } | null = null;
    let dropdown: DropdownComponent | null = null;
    const swatch = setting.controlEl.createSpan({ cls: "paper-canvas-swatch", attr: { "aria-hidden": "true" } });
    const paintSwatch = () => {
      swatch.setAttribute("data-canvas-color", get());
      swatch.style.setProperty("--paper-canvas-swatch", get().length === 1 ? `rgb(var(--canvas-color-${get()}))` : get());
    };
    paintSwatch();
    setting.addDropdown((dd) => {
      dropdown = dd;
      for (const key of Object.keys(CANVAS_COLOR_PRESET_LABELS) as Array<keyof typeof CANVAS_COLOR_PRESET_LABELS>) {
        dd.addOption(key, `${CANVAS_COLOR_PRESET_LABELS[key]} (${key})`);
      }
      dd.addOption(CUSTOM_COLOR, C.colorCustom);
      dd.setValue(isPreset ? current : CUSTOM_COLOR);
      dd.selectEl.setAttribute("aria-label", name);
      dd.onChange((value) => {
        const next = value === CUSTOM_COLOR ? lastHex : value;
        if (!isCanvasColor(next)) return;
        set(next);
        picker?.setDisabled(value !== CUSTOM_COLOR);
        paintSwatch();
        void this.commit();
      });
    });
    setting.addColorPicker((cp) => {
      picker = cp;
      cp.setValue(lastHex);
      cp.setDisabled(isPreset);
      cp.onChange((hex) => {
        const value = hex.toLowerCase();
        if (!isCanvasColor(value)) return;
        lastHex = value;
        set(value);
        dropdown?.setValue(CUSTOM_COLOR);
        paintSwatch();
        this.commitSoon();
      });
    });
    setting.controlEl.querySelector('input[type="color"]')?.setAttribute("aria-label", `${name}: ${C.colorPickerLabel}`);
  }

  // --- Preview ---------------------------------------------------------------------

  private renderPreview(root: HTMLElement): void {
    const wrap = root.createDiv({ cls: "paper-canvas-preview" });
    new Setting(wrap).setName(C.previewTitle).setDesc(C.previewDesc).setHeading();
    let fileDropdown: DropdownComponent | null = null;
    new Setting(wrap)
      .setName(C.previewFile)
      .addDropdown((dd) => {
        fileDropdown = dd;
        dd.selectEl.setAttribute("aria-label", C.previewFile);
        dd.onChange((path) => {
          this.previewPath = path;
          this.refreshPreview();
        });
      });
    new Setting(wrap)
      .setName(C.previewMode)
      .addDropdown((dd) => {
        dd.addOption("drawing", C.previewModeDrawing);
        dd.addOption("outline", C.previewModeOutline);
        dd.setValue(this.previewMode);
        dd.onChange((mode) => {
          this.previewMode = mode === "outline" ? "outline" : "drawing";
          this.refreshPreview();
        });
      })
      .addToggle((t) => {
        t.setTooltip(C.previewRawJson);
        t.toggleEl.setAttribute("aria-label", C.previewRawJson);
        t.setValue(this.rawJson);
        t.onChange((on) => {
          this.rawJson = on;
          this.refreshPreview();
        });
      });
    const summary = wrap.createEl("p", { cls: "paper-setting-note", attr: { "aria-live": "polite" } });
    const empty = wrap.createEl("p", { cls: "paper-setting-note", text: C.previewEmpty });
    const drawing = wrap.createDiv({ cls: "paper-canvas-preview-drawing" });
    const outline = wrap.createDiv({ cls: "paper-canvas-preview-outline" });
    const raw = wrap.createEl("pre", { cls: "paper-canvas-preview-raw" });
    if (fileDropdown) {
      this.preview = { fileDropdown, summary, empty, drawing, outline, raw };
    }
  }

  private refreshPreview(): void {
    const p = this.preview;
    if (!p || !p.drawing.isConnected) return;
    let canvases: GeneratedCanvas[];
    try {
      canvases = this.plugin.canvasPreview(this.draft);
    } catch {
      canvases = [];
    }
    const paths = canvases.map((c) => c.path);
    if (!this.previewPath || !paths.includes(this.previewPath)) {
      this.previewPath = paths[0] ?? null;
    }
    const select = p.fileDropdown.selectEl;
    select.empty();
    for (const path of paths) {
      p.fileDropdown.addOption(path, path);
    }
    if (this.previewPath) p.fileDropdown.setValue(this.previewPath);
    p.fileDropdown.setDisabled(paths.length === 0);

    p.empty.toggleClass("paper-is-hidden", this.plugin.settings.lastPayload !== null);
    const selected = canvases.find((c) => c.path === this.previewPath) ?? null;
    if (selected) {
      const doc = selected.document;
      const groups = doc.nodes.filter((n) => n.type === "group").length;
      p.summary.setText(canvasPreviewSummary(doc.nodes.length - groups, doc.edges.length, groups));
    } else {
      p.summary.setText("");
    }

    const drawingMode = this.previewMode === "drawing";
    p.drawing.toggleClass("paper-is-hidden", !drawingMode);
    p.outline.toggleClass("paper-is-hidden", drawingMode);
    if (drawingMode) {
      if (selected && selected.document.nodes.length > 0) {
        renderPreviewDrawing(p.drawing, buildPreviewModel(selected.document), C.previewDrawingLabel);
      } else {
        p.drawing.empty();
        p.drawing.createEl("p", { cls: "paper-setting-note", text: C.previewNoNodes });
      }
    } else {
      renderOutline(p.outline, buildOutline(canvases), this.previewPath ?? "");
    }
    p.raw.toggleClass("paper-is-hidden", !this.rawJson || !selected);
    p.raw.setText(this.rawJson && selected ? serializeCanvas(selected.document) : "");
  }
}
