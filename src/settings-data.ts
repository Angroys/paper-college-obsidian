import { normalizeSyncPayload } from "./api";
import { migratePresetStore } from "./canvas/store";
import { DEFAULT_SETTINGS, type CanvasManifest, type PaperPluginSettings } from "./types";

/**
 * Upgrades whatever `data.json` holds to the current settings shape. Never
 * throws: a fresh install or a malformed store gets preset #1, no cached
 * payload and no canvas manifest.
 */
export function migrateSettings(stored: unknown): PaperPluginSettings {
  const raw =
    stored && typeof stored === "object" ? (stored as Partial<PaperPluginSettings>) : {};
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    canvasPresets: migratePresetStore(raw.canvasPresets),
    lastPayload:
      raw.lastPayload && typeof raw.lastPayload === "object"
        ? normalizeSyncPayload(raw.lastPayload)
        : null,
    canvasManifest: normalizeManifest(raw.canvasManifest),
  };
}

export function normalizeManifest(raw: unknown): CanvasManifest | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.folder !== "string" || !Array.isArray(record.paths)) {
    return null;
  }
  return {
    folder: record.folder,
    paths: record.paths.filter((p): p is string => typeof p === "string"),
  };
}
