import type { SignedUrlResponse, SyncFigureHighlight, SyncPayload } from "./types";
import {
  bearerHeaders,
  figureImageApiUrl,
  signedFileApiUrl,
  syncApiUrl,
} from "./urls";

export type SyncFetchResult =
  | { ok: true; payload: SyncPayload }
  | { ok: false; status: number; kind: "auth" | "offline" | "server" | "unknown" };

export type SignedUrlFetchResult =
  | { ok: true; value: SignedUrlResponse; expiresAt: number }
  | { ok: false; status: number; kind: "auth" | "missing" | "offline" | "server" | "unknown" };

export type FigureImageResult =
  | { ok: true; data: ArrayBuffer }
  | { ok: false; status: number; kind: "auth" | "missing" | "offline" | "server" | "unknown" };

export async function fetchSyncPayload(
  fetchFn: typeof fetch,
  baseUrl: string,
  token: string,
): Promise<SyncFetchResult> {
  let response: Response;
  try {
    response = await fetchFn(syncApiUrl(baseUrl), {
      method: "GET",
      headers: bearerHeaders(token),
    });
  } catch {
    return { ok: false, status: 0, kind: "offline" };
  }

  if (response.status === 401) {
    return { ok: false, status: 401, kind: "auth" };
  }
  if (response.status >= 500) {
    return { ok: false, status: response.status, kind: "server" };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, kind: "unknown" };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, status: response.status, kind: "unknown" };
  }

  const payload = normalizeSyncPayload(json);
  return { ok: true, payload };
}

// Ids arrive from JSON as unknown, so anything that isn't already a primitive
// would stringify to "[object Object]" and pass the non-empty id filters below.
function idOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" ? String(value) : "";
}

export function normalizeSyncPayload(json: unknown): SyncPayload {
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const papers = Array.isArray(record.papers)
    ? record.papers
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
        .map((p) => ({
          id: idOf(p.id),
          title: typeof p.title === "string" ? p.title : "",
          added_from_paper_id: idOf(p.added_from_paper_id) || null,
        }))
        .filter((p) => p.id.length > 0)
    : [];
  const glossary_terms = Array.isArray(record.glossary_terms)
    ? record.glossary_terms
        .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
        .map((t) => ({
          id: idOf(t.id),
          term: typeof t.term === "string" ? t.term : "",
          explanation: typeof t.explanation === "string" ? t.explanation : "",
          tags: Array.isArray(t.tags) ? t.tags.map((tag) => String(tag)) : [],
          rating: typeof t.rating === "number" ? t.rating : null,
          paper_id: idOf(t.paper_id),
          created_at: typeof t.created_at === "string" ? t.created_at : "",
          normalized_term:
            typeof t.normalized_term === "string" ? t.normalized_term : "",
          highlight_id:
            typeof t.highlight_id === "string" ? t.highlight_id : null,
        }))
        .filter((t) => t.id.length > 0)
    : [];
  const projects = records(record.projects)
    .map((p) => ({
      id: idOf(p.id),
      name: typeof p.name === "string" ? p.name : null,
      created_at: typeof p.created_at === "string" ? p.created_at : null,
    }))
    .filter((p) => p.id.length > 0);
  const project_papers = records(record.project_papers)
    .map((pp) => ({
      project_id: idOf(pp.project_id),
      paper_id: idOf(pp.paper_id),
      added_at: typeof pp.added_at === "string" ? pp.added_at : null,
    }))
    .filter((pp) => pp.project_id.length > 0 && pp.paper_id.length > 0);
  const highlights = records(record.highlights)
    .map((h) => ({
      id: idOf(h.id),
      paper_id: idOf(h.paper_id),
      selected_text: typeof h.selected_text === "string" ? h.selected_text : "",
      page_number: typeof h.page_number === "number" ? h.page_number : null,
      created_at: typeof h.created_at === "string" ? h.created_at : null,
    }))
    .filter((h) => h.id.length > 0 && h.paper_id.length > 0);

  // `canvases` is legacy: the plugin builds canvases locally from the arrays
  // above with the active preset, so whatever the server sends is dropped.
  const normalized: SyncPayload = { papers, glossary_terms, projects, project_papers, highlights };
  // Only an explicit array means "this is the full figure list"; an absent
  // field (older server) must not read as "every figure was deleted".
  if (Array.isArray(record.figure_highlights)) {
    normalized.figure_highlights = normalizeFigures(record.figure_highlights);
  }
  return normalized;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFigures(raw: unknown[]): SyncFigureHighlight[] {
  return raw
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({
      id: idOf(f.id),
      paper_id: idOf(f.paper_id),
      page_number: typeof f.page_number === "number" ? f.page_number : NaN,
      label: nullableString(f.label),
      caption: nullableString(f.caption),
      note: nullableString(f.note),
      created_at: typeof f.created_at === "string" ? f.created_at : "",
      updated_at: typeof f.updated_at === "string" ? f.updated_at : "",
    }))
    .filter(
      (f) =>
        f.id.length > 0 &&
        f.paper_id.length > 0 &&
        Number.isInteger(f.page_number) &&
        f.page_number >= 1,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)
  );
}

/**
 * PNG bytes of one figure highlight (`GET /api/obsidian/figures/:id`), same
 * Bearer auth and status mapping as the sync call. Anything that is not a
 * PNG is refused, so a proxy error page can never land in the vault as an
 * image.
 */
export async function fetchFigureImage(
  fetchFn: typeof fetch,
  baseUrl: string,
  token: string,
  figureId: string,
): Promise<FigureImageResult> {
  let response: Response;
  try {
    response = await fetchFn(figureImageApiUrl(baseUrl, figureId), {
      method: "GET",
      headers: { ...bearerHeaders(token), Accept: "image/png" },
    });
  } catch {
    return { ok: false, status: 0, kind: "offline" };
  }

  if (response.status === 401) {
    return { ok: false, status: 401, kind: "auth" };
  }
  if (response.status === 404) {
    return { ok: false, status: 404, kind: "missing" };
  }
  if (response.status >= 500) {
    return { ok: false, status: response.status, kind: "server" };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, kind: "unknown" };
  }

  let data: ArrayBuffer;
  try {
    data = await response.arrayBuffer();
  } catch {
    return { ok: false, status: response.status, kind: "unknown" };
  }
  if (!isPng(data)) {
    return { ok: false, status: response.status, kind: "unknown" };
  }
  return { ok: true, data };
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    : [];
}

export async function fetchSignedUrl(
  fetchFn: typeof fetch,
  baseUrl: string,
  token: string,
  paperId: string,
  nowMs = Date.now(),
): Promise<SignedUrlFetchResult> {
  let response: Response;
  try {
    response = await fetchFn(signedFileApiUrl(baseUrl, paperId), {
      method: "GET",
      headers: bearerHeaders(token),
    });
  } catch {
    return { ok: false, status: 0, kind: "offline" };
  }

  if (response.status === 401) {
    return { ok: false, status: 401, kind: "auth" };
  }
  if (response.status === 404) {
    return { ok: false, status: 404, kind: "missing" };
  }
  if (response.status >= 500) {
    return { ok: false, status: response.status, kind: "server" };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, kind: "unknown" };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, status: response.status, kind: "unknown" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, status: response.status, kind: "unknown" };
  }
  const record = json as Record<string, unknown>;
  if (typeof record.url !== "string" || record.url.length === 0) {
    return { ok: false, status: response.status, kind: "unknown" };
  }
  const expiresIn =
    typeof record.expiresIn === "number" && record.expiresIn > 0
      ? record.expiresIn
      : 3600;
  return {
    ok: true,
    value: { url: record.url, expiresIn },
    expiresAt: nowMs + expiresIn * 1000,
  };
}

export function signedUrlExpired(expiresAt: number, nowMs = Date.now(), skewMs = 30_000): boolean {
  return nowMs + skewMs >= expiresAt;
}
