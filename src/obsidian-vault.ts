import { normalizePath, type TAbstractFile, type Vault } from "obsidian";
import type { VaultWriter } from "./sync-apply";
import { isAllowedVaultPath } from "./payload-guard";

/**
 * Obsidian vault writes: `.md` / `.canvas` only, atomic replace so a
 * failed write leaves the previous file. Never `createBinary`.
 */
export class ObsidianVaultWriter implements VaultWriter {
  constructor(private readonly vault: Vault) {}

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(normalizePath(path)) != null;
  }

  async isFile(path: string): Promise<boolean> {
    const found = this.vault.getAbstractFileByPath(normalizePath(path));
    return found != null && "extension" in found;
  }

  async isFolder(path: string): Promise<boolean> {
    const found = this.vault.getAbstractFileByPath(normalizePath(path));
    return found != null && !("extension" in found);
  }

  async read(path: string): Promise<string | null> {
    const found = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!found || !("extension" in found)) {
      return null;
    }
    try {
      return await this.vault.read(found as never);
    } catch {
      return null;
    }
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!isAllowedVaultPath(normalized)) {
      throw new Error("refusing to write a non-markdown/canvas path");
    }
    const previous = await this.read(normalized);
    try {
      const existing = this.vault.getAbstractFileByPath(normalized);
      if (existing && "extension" in existing) {
        await this.vault.modify(existing as never, content);
      } else {
        await this.vault.create(normalized, content);
      }
    } catch (error) {
      if (previous !== null) {
        try {
          const existing = this.vault.getAbstractFileByPath(normalized);
          if (existing && "extension" in existing) {
            await this.vault.modify(existing as never, previous);
          }
        } catch {
          // keep going; previous restore is best-effort
        }
      }
      throw error;
    }
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.vault.getAbstractFileByPath(normalized);
    if (existing) {
      if ("extension" in existing) {
        throw new Error("folder is a file");
      }
      return;
    }
    await this.vault.createFolder(normalized);
  }
}

export function isTFile(file: TAbstractFile | null): file is TAbstractFile & { extension: string } {
  return file != null && "extension" in file;
}
