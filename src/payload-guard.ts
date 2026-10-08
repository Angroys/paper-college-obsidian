/**
 * Abort PDF / binary parts of a sync payload before any vault write.
 * Plugin writes only `.md` and `.canvas`.
 */

const PDF_MAGIC = "%PDF";
const PDF_PATH = /\.pdf(?:$|[?#])/i;
const SIGNED_STORAGE = /\/storage\/v1\/object\/sign\//i;
/** Any Supabase storage object URL/path (public, signed or authenticated). */
const STORAGE_OBJECT = /\/storage\/v1\/object\//i;
/** A field this long is a blob, not prose (highlights and terms are short). */
export const MAX_CANVAS_FIELD_CHARS = 100_000;
const BINARY_KEY = /pdf|binary|bytes|file_b64|pdf_bytes/i;

export type PayloadPart = "glossary" | "papers" | "canvas";

export type PdfHazard = {
  part: PayloadPart;
  reason: string;
};

export function findPdfHazards(payload: unknown): PdfHazard[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const hazards: PdfHazard[] = [];

  if (scanValue(record.glossary_terms, "glossary").length > 0) {
    hazards.push({ part: "glossary", reason: "glossary payload contains PDF/binary" });
  }
  if (scanValue(record.papers, "papers").length > 0) {
    hazards.push({ part: "papers", reason: "papers payload contains PDF/binary" });
  }
  // Canvases are generated locally from every array below (`canvases` itself
  // is legacy and ignored). Their text is prose — papers routinely mention
  // "appendix.pdf" or "%PDF" — so only real hazards block them: a field that
  // starts with the `%PDF-` header, a storage-object URL/path, a binary
  // value or binary-named field, or an oversized blob.
  if (
    [
      record.papers,
      record.glossary_terms,
      record.projects,
      record.project_papers,
      record.highlights,
    ].some((value) => hasRealHazard(value))
  ) {    hazards.push({ part: "canvas", reason: "canvas payload contains PDF/binary" });
  }

  return hazards;
}

function hasRealHazard(value: unknown, depth = 0): boolean {
  if (depth > 12 || value == null) {
    return false;
  }
  if (typeof value === "string") {
    return (
      value.trimStart().startsWith(`${PDF_MAGIC}-`) ||
      STORAGE_OBJECT.test(value) ||
      value.length > MAX_CANVAS_FIELD_CHARS
    );
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasRealHazard(item, depth + 1));
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (BINARY_KEY.test(key) && nested != null && nested !== "") {
        return true;
      }
      if (hasRealHazard(nested, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function scanValue(value: unknown, part: PayloadPart, depth = 0): string[] {
  if (depth > 12 || value == null) {
    return [];
  }
  if (typeof value === "string") {
    if (value.includes(PDF_MAGIC) || PDF_PATH.test(value) || SIGNED_STORAGE.test(value)) {
      return [part];
    }
    return [];
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    if (looksLikePdfBytes(value)) {
      return [part];
    }
    return [part];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = scanValue(item, part, depth + 1);
      if (hit.length > 0) {
        return hit;
      }
    }
    return [];
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "file") {
      const file = typeof obj.file === "string" ? obj.file : "";
      if (PDF_PATH.test(file) || file.toLowerCase().includes("pdf")) {
        return [part];
      }
    }
    for (const [key, nested] of Object.entries(obj)) {
      if (/pdf|binary|bytes|file_b64|pdf_bytes/i.test(key)) {
        if (typeof nested === "string" && nested.length > 0) {
          return [part];
        }
        if (nested && typeof nested === "object") {
          return [part];
        }
      }
      const hit = scanValue(nested, part, depth + 1);
      if (hit.length > 0) {
        return hit;
      }
    }
  }
  return [];
}

function looksLikePdfBytes(value: ArrayBuffer | ArrayBufferView): boolean {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length < 4) {
    return false;
  }
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export function isAllowedVaultPath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".pdf") || lower.includes(".pdf/") || lower.includes("/.pdf")) {
    return false;
  }
  return lower.endsWith(".md") || lower.endsWith(".canvas");
}

export function isJsonCanvas(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.nodes) && Array.isArray(record.edges);
}
