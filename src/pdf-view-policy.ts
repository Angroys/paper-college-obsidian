/**
 * Allowed vs forbidden Paper PDF ItemView toolbar controls.
 * Absence of Save / Download / Add to vault is the policy — do not
 * render those names even as disabled controls.
 */

export const PDF_TOOLBAR_CONTROLS = [
  "close",
  "title",
  "page",
  "zoom-out",
  "zoom-in",
  "open-in-paper",
] as const;

export type PdfToolbarControl = (typeof PDF_TOOLBAR_CONTROLS)[number];

export const PDF_FORBIDDEN_CONTROLS = [
  "save",
  "download",
  "add to vault",
  "add-to-vault",
  "print",
  "print-to-file",
  "share",
] as const;

export function isForbiddenPdfControl(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (PDF_FORBIDDEN_CONTROLS as readonly string[]).includes(normalized);
}

export function pdfToolbarControlNames(): readonly string[] {
  return PDF_TOOLBAR_CONTROLS;
}
