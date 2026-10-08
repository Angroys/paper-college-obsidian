/**
 * English plugin / vault-note strings from `design/obsidian-copy-spec.md`
 * §5–6, §8.4–8.9, §9 (`obsidian.plugin.*` / `obsidian.note.*`).
 *
 * Buttons stay ≤24 characters. No Save / Download / Add-to-vault copy.
 */

export const PLUGIN_COPY = {
  commandConnect: "Connect",
  commandSync: "Sync glossary and mindmap",
  commandOpenPdf: "Open paper PDF…",
  commandOpenFolder: "Open Paper folder",
  commandDisconnect: "Disconnect",

  connect: "Connect",
  syncNow: "Sync now",
  disconnect: "Disconnect",
  cancel: "Cancel",
  retry: "Retry",
  close: "Close",
  copied: "Copied.",
  offline: "No connection. Check your network and try again.",

  noticeFirstRun:
    "Paper can put your glossary and mindmap in this vault. PDFs stay on Paper.",
  noticeFirstRunDismiss: "Not now",
  noticeSyncError:
    "Couldn't sync. Your existing notes were left as they are.",
  canvasResyncNeedsSync:
    "Connect and sync once so Paper can build your canvases.",
  noticeSyncEmpty:
    "Synced. No glossary terms on Paper yet. The folder is ready.",

  connectionTitle: "Connection",
  connectionDisconnected:
    "This vault is not connected to Paper. Create a pairing code in Paper Settings, then paste it here.",
  connectionManualUrl: "If the browser did not open, copy this link:",
  connectionCodeLabel: "Pairing code",
  connectionCodeHelp: "Paste the numbers from Paper Settings.",
  connectionReplace: "Replace connection",
  connectionReplaceTitle: "Replace this connection?",
  connectionReplaceBody:
    "This vault will use a new pairing. Notes already in the folder stay.",
  connectionReplaceConfirm: "Replace",

  folderTitle: "Vault folder",
  folderHelp:
    "Glossary notes, paper notes, and the mindmap go in this folder. PDFs are not saved here.",
  folderError:
    "Choose a folder name. If that path is already a file, pick a different name.",
  folderDefault: "Paper",

  syncTitle: "Sync",
  syncStartup: "Sync on startup",
  syncDisabledHelp: "Connect this vault before you sync.",
  overwriteDisclosure:
    "On sync, Paper replaces files it created in this folder. Your other notes are left alone.",

  pdfTitle: "PDF",
  pdfPolicy:
    "Papers open through Paper. The PDF is not saved to this vault or to your computer.",

  siteUrlTitle: "Paper URL",
  siteUrlHelp:
    "Default https://paper.college. Use http://localhost:3000 when developing.",

  statusNever: "Not synced yet",
  statusSyncing: "Syncing…",
  statusLastSyncFallback: "Synced",
  statusError: "Sync failed",

  pickerTitle: "Open paper PDF",
  pickerEmpty: "No papers from the last sync. Sync to list them here.",
  pickerUntitled: "Untitled paper",
  pickerSearch: "Search papers",

  pdfLoading: "Loading paper…",
  pdfOpenInPaper: "Open in Paper",
  pdfOffline:
    "This paper needs a network connection to open. Your vault notes still work.",
  pdfPartialPages: "Some pages could not load. Try again.",
  pdfErrorAuth: "Connection expired. Reconnect to open this paper.",
  pdfErrorMissing: "This paper is no longer on Paper.",
  pdfErrorRetry: "Couldn't open this paper. Try again.",
  pdfErrorEmpty: "No paper selected. Close this view.",
  pdfErrorRefresh: "Couldn't refresh this paper. Try again.",
  pdfZoomIn: "Zoom in",
  pdfZoomOut: "Zoom out",

  connectInvalidCode:
    "That code did not work. Create a new code in Paper Settings.",
  connectExpiredCode:
    "That code expired. Create a new one in Paper Settings.",
  connectOfferSync:
    "Connected. Sync your glossary and mindmap when you are ready.",
  connectExchanging: "Connecting…",

  disconnectTitle: "Disconnect this vault?",
  disconnectBody:
    "This vault will stop getting updates. Glossary notes, paper notes, and the mindmap already in the vault stay where they are.",
  disconnectConfirm: "Disconnect",

  noteFolderEmpty:
    "No glossary terms yet. Highlight terms in your papers on Paper, then sync.",
  notePaperOpenPdf: "Open PDF",
  noteGlossaryOpenPdf: "Open paper PDF",

  failedPartGlossary: "glossary notes",
  failedPartMindmap: "mindmap",
  failedPartFigures: "figure images",

  noteFiguresHeading: "Figures",
  noteFigureCaption: "Caption",
  noteFigureNote: "Note",

  canvasFallbackTitle: "Mindmap",
} as const;

export function connectedAs(accountLabel: string): string {
  return `Connected as ${accountLabel}.`;
}

export function statusBarText(slot: string): string {
  return `Paper · ${slot}`;
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return PLUGIN_COPY.statusLastSyncFallback;
  }
  const deltaSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (deltaSec < 60) {
    return `${deltaSec} sec ago`;
  }
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) {
    return `${deltaMin} min ago`;
  }
  const deltaHours = Math.round(deltaMin / 60);
  if (deltaHours < 48) {
    return `${deltaHours} hour${deltaHours === 1 ? "" : "s"} ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`;
}

export function termCountPhrase(termCount: number): string {
  return termCount === 1 ? "1 term" : `${termCount} terms`;
}

export function paperCountPhrase(paperCount: number): string {
  return paperCount === 1 ? "1 paper" : `${paperCount} papers`;
}

export function failedPartTerms(termCount: number): string {
  return termCountPhrase(termCount);
}

export function syncSuccessNotice(
  termCount: number,
  paperCount: number,
  first: boolean,
): string {
  const base = `Synced ${termCountPhrase(termCount)}, ${paperCountPhrase(paperCount)}, and your mindmap.`;
  if (first) {
    return `${base} PDFs stay on Paper and were not copied here.`;
  }
  return base;
}

export function syncPartialNotice(failedPart: string): string {
  return `Sync finished in part. ${failedPart} did not update. Earlier files were kept.`;
}

export function pdfPageLabel(current: number | null, total: number | null): string {
  if (current == null || total == null) {
    return "Page – of –";
  }
  return `Page ${current} of ${total}`;
}

export function figureHeading(page: number, label: string | null): string {
  return label ? `Page ${page} · ${label}` : `Page ${page}`;
}

export function figureOpenPageLink(page: number): string {
  return `Open page ${page} in Paper`;
}

export function pdfTabTitle(paperTitle: string | null | undefined): string {
  const title = paperTitle?.trim();
  return title ? title : PLUGIN_COPY.pickerUntitled;
}

// --- Generated canvases (src/canvas/) ---------------------------------------

/** Text the canvas engine writes into generated `.canvas` files. */
export const CANVAS_COPY = {
  libraryHub: "Library",
  projectsHub: "Projects",
  papersHub: "Papers",
  termsHub: "Terms",
  unassignedProject: "Unassigned",
  unassignedHint: "Papers that are not in a project yet.",
  projectUntitled: "Untitled project",
  paperUntitled: "Untitled paper",
  openInPaper: "Open in Paper",
  groupTerms: "Terms",
  groupHighlights: "Highlights",
  groupNotes: "Notes",
  groupMerged: "From this paper",
  groupProjectTerms: "Shared terms",
  highlightNoPage: "Highlight",
  emptyLibrary: "Your mindmap will grow here. Add papers in Paper, then sync again.",
  emptyProject: "No papers in this project yet. Add papers in Paper, then sync again.",
  emptyPaper: "Nothing captured yet. Highlight or explain text in Paper, then sync again.",
  emptyTerms: "No terms yet. Explain a highlight in Paper to add one.",
  fullList: "Full list",
} as const;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

export function canvasCountProjects(n: number): string {
  return plural(n, "project", "projects");
}

export function canvasCountPapers(n: number): string {
  return plural(n, "paper", "papers");
}

export function canvasCountTerms(n: number): string {
  return plural(n, "term", "terms");
}

export function canvasCountHighlights(n: number): string {
  return plural(n, "highlight", "highlights");
}

export function canvasTermInPapers(n: number): string {
  return `In ${plural(n, "paper", "papers")}`;
}

export function canvasHighlightPage(page: number): string {
  return `Page ${page}`;
}

export function canvasRatedLine(n: number): string {
  return `Rated ${n} of 5`;
}

export function canvasMoreLine(n: number): string {
  return `+${n} more`;
}

/** Shipped canvas preset names and one-line descriptions, by preset id. */
export const CANVAS_PRESET_COPY = {
  "library-tree": {
    name: "Library tree",
    description: "Library, projects and papers as a top-down tree; click through three levels.",
  },
  "library-radial": {
    name: "Library radial",
    description: "Library at the centre with projects and papers on rings; three levels.",
  },
  "library-columns": {
    name: "Library columns",
    description: "One overview with a column per project and its papers listed below.",
  },
  "project-tree": {
    name: "Project tree",
    description: "Each project canvas shows its papers and what you captured in them.",
  },
  "project-radial": {
    name: "Project radial",
    description: "Projects as radial maps you click through, three levels deep.",
  },
  "paper-columns": {
    name: "Paper columns",
    description: "A column per paper with its terms, highlights and notes stacked below.",
  },
  "paper-radial": {
    name: "Paper radial",
    description: "Papers around a centre, each ringed by what you captured.",
  },
  "term-tree": {
    name: "Term tree",
    description: "Every term with the papers it appears in, left to right.",
  },
  "term-radial": {
    name: "Term radial",
    description: "Terms around a centre with the papers they appear in on the outer ring.",
  },
  "library-flat": {
    name: "Library flat overview",
    description: "One flat overview tree; unfiled papers hang off the library itself.",
  },
  "reading-desk": {
    name: "Reading desk",
    description: "Papers side by side with highlights first, sized to their text.",
  },
  "glossary-atlas": {
    name: "Glossary atlas",
    description: "A grid of terms, each opening its own canvas of papers and highlights.",
  },
  "highlight-reel": {
    name: "Highlight reel",
    description: "Only highlights, page by page, flowing left to right.",
  },
  "citation-web": {
    name: "Citation web",
    description: "Radial library with shared terms and citations linked across papers.",
  },
  "minimal-outline": {
    name: "Minimal outline",
    description: "Plain titles, no colours, no arrows; a quiet outline.",
  },
  "study-board": {
    name: "Study board",
    description: "Project boards with large cards that hold full definitions.",
  },
  "project-kanban": {
    name: "Project kanban",
    description: "A column per project, papers stacked like cards.",
  },
  "concept-spine": {
    name: "Concept spine",
    description: "Most shared terms first, linked in a spine, with their papers below.",
  },
  "wide-timeline": {
    name: "Wide timeline",
    description: "Papers in date order along a wide row, linked in sequence.",
  },
  "dense-index": {
    name: "Dense index",
    description: "Small cards in tight grids; the most on one screen.",
  },
} as const;

// --- Settings: canvas layout (settings-tab.ts, canvas/preview.ts) -----------

export const CANVAS_SETTINGS_COPY = {
  title: "Canvas layout",
  intro:
    "Choose how Paper lays out the canvases it writes. Edits save as you go; re-sync to rewrite the canvases in your vault.",
  preset: "Preset",
  reset: "Reset preset",
  resetDesc: "Discard your edits to this preset and restore the shipped version.",
  resetDone: "Preset restored.",
  resync: "Re-sync with this preset",
  resyncDesc: "Rewrite the canvases in your vault with this preset. Canvases Paper wrote for the previous preset are removed.",
  resyncBusy: "Syncing…",
  edit: "Edit preset",
  edited: "Edited",

  details: "Name and description",
  name: "Name",
  description: "Description",

  structure: "Structure",
  root: "Root",
  rootDesc: "What the overview canvas is built around.",
  depth: "Depth",
  depthDesc: "Two levels keep children inline on one canvas; three levels add canvases to click through.",
  emitTitle: "Canvas files to write",
  emitOverview: "Overview canvas",
  emitProject: "Project canvases",
  emitPaper: "Paper canvases",
  emitTerm: "Term canvases",
  unassigned: "Papers in no project",

  grouping: "Grouping",
  groupTerms: "Terms inside a paper",
  groupHighlights: "Highlights inside a paper",
  groupNotes: "Notes inside a paper",
  projectTerms: "Project-level terms",
  sort: "Sort by",
  maxTerms: "Max terms per canvas",
  maxHighlights: "Max highlights per canvas",
  capDesc: "Extra items collapse into a \"+N more\" note. Use 0 for no limit.",

  layout: "Layout",
  algorithm: "Algorithm",
  siblingGap: "Gap between siblings",
  levelGap: "Gap between levels",
  groupPadding: "Padding inside groups",
  groupColumns: "Columns inside a group",
  gridColumns: "Grid columns",
  gridColumnsDesc: "Used by the grid layout. Use 0 to pick automatically.",
  sizing: "Node sizing",
  maxLines: "Max lines per card",
  maxLinesDesc: "Longer text is shortened. Use 0 for no limit.",
  sizesTitle: "Card sizes",
  sizesDesc: "Minimum and maximum width and height, in canvas pixels.",
  minWidth: "Min width",
  maxWidth: "Max width",
  minHeight: "Min height",
  maxHeight: "Max height",

  connections: "Connections",
  siblings: "Link siblings",
  siblingsDesc: "Chain cards that share a parent.",
  backlinks: "Cross links",
  backlinksDesc: "Link shared terms and citations across papers.",
  arrow: "Arrow at the end of links",
  sides: "Link sides",
  noLabels: "Links never carry labels.",

  look: "Look",
  colorMode: "Colour cards by",
  kindColorsTitle: "Colour per kind",
  levelColorsTitle: "Colour per level",
  colorCustom: "Custom colour",
  colorPickerLabel: "Pick a colour",
  hubText: "Hub text",
  termText: "Term text",
  highlightText: "Highlight text",

  files: "File links",
  noteNodesTitle: "Show note files",
  noteNodesDesc: "Embed paper and glossary notes as file cards on these canvases.",
  paperNode: "Paper cards",
  termNode: "Term cards",
  backlinkToParent: "Link back to the parent canvas",
  paperFolders: "Paper canvas folders",

  css: "Custom CSS",
  cssDesc:
    "Applied only while a canvas Paper generated is open. Rules are scoped under .paper-canvas-scope so they never reach other canvases.",
  cssPlaceholder: ".canvas-node { }",

  previewTitle: "Preview",
  previewDesc: "Built from your last sync. Nothing is written until you re-sync.",
  previewEmpty: "Sync once to preview your canvases.",
  previewFile: "Canvas file",
  previewModeDrawing: "Drawing",
  previewModeOutline: "Outline",
  previewMode: "View",
  previewRawJson: "Show raw JSON",
  previewDrawingLabel: "Scaled drawing of the selected canvas",
  previewNoNodes: "This canvas has no cards.",
} as const;

export const CANVAS_LEVEL_LABELS = {
  overview: "Overview",
  project: "Project",
  paper: "Paper",
  term: "Term",
} as const;

export const CANVAS_KIND_LABELS = {
  hub: "Hub",
  project: "Project",
  paper: "Paper",
  term: "Term",
  highlight: "Highlight",
  note: "Note",
  more: "More",
  up: "Back link",
  empty: "Empty state",
  group: "Group",
} as const;

export const CANVAS_COLOR_PRESET_LABELS = {
  "1": "Red",
  "2": "Orange",
  "3": "Yellow",
  "4": "Green",
  "5": "Cyan",
  "6": "Purple",
} as const;

export function canvasLevelColorLabel(level: number): string {
  return level === 0 ? "Level 0 (hub)" : level === 3 ? "Level 3 and deeper" : `Level ${level}`;
}

export function canvasPreviewSummary(nodes: number, edges: number, groups: number): string {
  const n = nodes === 1 ? "1 card" : `${nodes} cards`;
  const e = edges === 1 ? "1 link" : `${edges} links`;
  const g = groups === 1 ? "1 group" : `${groups} groups`;
  return `${n}, ${g}, ${e}`;
}

/** Option labels for every enum in `CanvasPreset`, keyed by value. */
export const CANVAS_OPTION_LABELS = {
  root: { library: "Library", project: "Projects", paper: "Papers", term: "Terms" },
  depth: { "2": "Two levels (one overview)", "3": "Three levels (click through)" },
  unassigned: { bucket: "An \"Unassigned\" bucket", root: "Attach to the root", hidden: "Hide them" },
  cluster: { separate: "Own box each", merged: "One shared box", hidden: "Hidden" },
  projectTerms: { all: "All terms", shared: "Only terms shared by 2+ papers", none: "None" },
  sort: { alpha: "Alphabetical", date: "Date", rating: "Rating", shared: "Papers sharing it" },
  algorithm: {
    "tree-TB": "Tree, top to bottom",
    "tree-LR": "Tree, left to right",
    radial: "Radial",
    columns: "Columns",
    grid: "Grid",
  },
  sizing: { fixed: "Fixed width", fit: "Fit to text" },
  arrow: { none: "None", end: "Arrow" },
  sides: { flow: "Follow the layout direction", nearest: "Nearest sides" },
  colorMode: { level: "Level", kind: "Kind", plain: "No colour" },
  hubText: {
    title: "Title only",
    counts: "Title and counts",
    "counts-link": "Title, counts and paper.college link",
  },
  termText: { definition: "Term and definition", term: "Term only" },
  highlightText: { page: "Highlight and page", text: "Text only" },
  entityNode: { text: "Text card", file: "Live note embed" },
  paperFolders: { project: "By project", flat: "Flat" },
} as const;
