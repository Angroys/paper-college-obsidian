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

export function pdfTabTitle(paperTitle: string | null | undefined): string {
  const title = paperTitle?.trim();
  return title ? title : PLUGIN_COPY.pickerUntitled;
}
