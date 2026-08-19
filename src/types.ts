export type SyncPaper = {
  id: string;
  title: string;
};

export type SyncGlossaryTerm = {
  id: string;
  term: string;
  explanation: string;
  tags: string[];
  rating: number | null;
  paper_id: string;
  created_at: string;
  normalized_term: string;
  highlight_id: string | null;
};

export type SyncCanvas = {
  path: string;
  document: {
    nodes: unknown[];
    edges: unknown[];
    paperCollege?: unknown;
  };
};

export type SyncPayload = {
  papers: SyncPaper[];
  glossary_terms: SyncGlossaryTerm[];
  canvases: SyncCanvas[];
};

export type PaperPluginSettings = {
  baseUrl: string;
  folder: string;
  token: string;
  deviceId: string;
  accountLabel: string;
  syncOnStartup: boolean;
  lastSyncAt: string | null;
  lastPapers: SyncPaper[];
  firstRunDismissed: boolean;
  firstSyncDone: boolean;
  lastSyncError: string | null;
  lastTermCount: number;
  lastPaperCount: number;
  lastCanvasOk: boolean;
};

export const DEFAULT_SETTINGS: PaperPluginSettings = {
  baseUrl: "https://paper.college",
  folder: "Paper",
  token: "",
  deviceId: "",
  accountLabel: "",
  syncOnStartup: false,
  lastSyncAt: null,
  lastPapers: [],
  firstRunDismissed: false,
  firstSyncDone: false,
  lastSyncError: null,
  lastTermCount: 0,
  lastPaperCount: 0,
  lastCanvasOk: false,
};

export type PlannedWriteKind = "glossary" | "paper" | "canvas" | "index";

export type PlannedWrite = {
  relativePath: string;
  content: string;
  kind: PlannedWriteKind;
};

export type ApplyPlan = {
  writes: PlannedWrite[];
  folder: string;
  glossaryAborted: boolean;
  canvasAborted: boolean;
  papersAborted: boolean;
  abortReasons: string[];
  termCount: number;
  paperCount: number;
  emptyGlossary: boolean;
};

export type ApplyResult = {
  written: string[];
  skippedUser: string[];
  failed: string[];
  folderError: string | null;
  glossaryOk: boolean;
  canvasOk: boolean;
  papersOk: boolean;
};

export type ExchangeSuccess = {
  ok: true;
  token: string;
  deviceId: string;
  accountLabel: string;
};

export type ExchangeFailure = {
  ok: false;
  kind: "invalid_code" | "expired_code" | "offline" | "unknown";
  status: number | null;
};

export type ExchangeResult = ExchangeSuccess | ExchangeFailure;

export type SignedUrlResponse = {
  url: string;
  expiresIn: number;
};
