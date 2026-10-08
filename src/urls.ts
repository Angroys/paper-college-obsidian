/**
 * Plugin URL helpers. Signed URLs are fetched at PDF-open time and must
 * never be written into vault markdown or canvas.
 */

export const DEFAULT_BASE_URL = "https://paper.college";
export const DEV_BASE_URL = "http://localhost:3000";
export const PDF_PROTOCOL_ACTION = "paper-open-pdf";
export const PDF_VIEW_TYPE = "paper-pdf-view";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeBaseUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_BASE_URL;
    }
    if (url.protocol === "http:" && url.hostname !== "localhost") {
      return DEFAULT_BASE_URL;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function settingsDeepLink(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/settings#obsidian`;
}

export function libraryUrl(baseUrl: string, paperId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/library/${paperId}`;
}

/**
 * Web-reader link for one page of a paper. The reader has no page deep link
 * yet, so `#page=N` is a forward-compatible hint: today it opens the paper
 * at the top; the plugin's `/library/` click interception skips these links
 * so they open on the web instead of in the in-vault PDF view.
 */
export function readerPageUrl(baseUrl: string, paperId: string, page: number): string {
  return `${libraryUrl(baseUrl, paperId)}#page=${page}`;
}

export function figureImageApiUrl(baseUrl: string, figureId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/obsidian/figures/${encodeURIComponent(figureId)}`;
}

export function pairingExchangeUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/obsidian/pairing/exchange`;
}

export function syncApiUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/obsidian/sync`;
}

/**
 * Path (and absolute URL) for the signed-file endpoint.
 * The plugin fetches this at view time; it is not a vault path.
 */
export function signedFileApiPath(paperId: string): string {
  return `/api/papers/${paperId}/file`;
}

export function signedFileApiUrl(baseUrl: string, paperId: string): string {
  return `${normalizeBaseUrl(baseUrl)}${signedFileApiPath(paperId)}`;
}

export function bearerHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export function openPdfProtocolUrl(paperId: string): string {
  return `obsidian://${PDF_PROTOCOL_ACTION}?paperId=${encodeURIComponent(paperId)}`;
}

/**
 * Extract a paper id from a stable library URL (`/library/{paperId}`),
 * including markdown-wrapped links. Does not accept signed storage URLs.
 */
export function parsePaperIdFromLibraryUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const markdown = trimmed.match(/\[[^\]]*\]\(([^)]+)\)/);
  const candidate = markdown ? markdown[1] : trimmed;

  const pathMatch = candidate.match(/\/library\/([^/?#\s)]+)\/?/);
  if (pathMatch) {
    const id = decodeURIComponent(pathMatch[1]);
    return id.length > 0 ? id : null;
  }

  try {
    const url = new URL(candidate);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "library") {
      return decodeURIComponent(parts[1]);
    }
  } catch {
    // not an absolute URL
  }

  return null;
}

export function parsePaperIdFromProtocol(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith(`obsidian://${PDF_PROTOCOL_ACTION}`)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    const id = url.searchParams.get("paperId");
    return id && id.length > 0 ? id : null;
  } catch {
    const match = trimmed.match(/[?&]paperId=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type CanvasPaperNode = {
  paperCollege?: {
    semanticType?: string;
    paperId?: string;
    libraryUrl?: string;
  };
  text?: string;
  type?: string;
};

/**
 * Paper-node activation: `paperCollege.semanticType === "paper"` or a
 * stable `/library/{paperId}` URL in the node body. Never a local .pdf path.
 */
export function paperIdFromCanvasNode(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }
  const record = node as CanvasPaperNode;
  const semantic = record.paperCollege;
  if (semantic?.semanticType === "paper" && typeof semantic.paperId === "string") {
    return semantic.paperId;
  }
  if (typeof semantic?.libraryUrl === "string") {
    const fromLibrary = parsePaperIdFromLibraryUrl(semantic.libraryUrl);
    if (fromLibrary) {
      return fromLibrary;
    }
  }
  if (typeof record.text === "string") {
    return parsePaperIdFromLibraryUrl(record.text);
  }
  return null;
}
