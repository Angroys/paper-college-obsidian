import type { SignedUrlResponse, SyncPayload } from "./types";
import { bearerHeaders, signedFileApiUrl, syncApiUrl } from "./urls";
import { isJsonCanvas } from "./payload-guard";

export type SyncFetchResult =
  | { ok: true; payload: SyncPayload }
  | { ok: false; status: number; kind: "auth" | "offline" | "server" | "unknown" };

export type SignedUrlFetchResult =
  | { ok: true; value: SignedUrlResponse; expiresAt: number }
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
  const rawCanvases = Array.isArray(record.canvases) ? record.canvases : [];
  const canvases: SyncPayload["canvases"] = rawCanvases
    .filter(
      (c): c is { path: string; document: unknown } =>
        !!c &&
        typeof c === "object" &&
        typeof (c as Record<string, unknown>).path === "string" &&
        isJsonCanvas((c as Record<string, unknown>).document),
    )
    .map((c) => ({
      path: c.path,
      document: c.document as SyncPayload["canvases"][number]["document"],
    }));

  return { papers, glossary_terms, canvases };
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
