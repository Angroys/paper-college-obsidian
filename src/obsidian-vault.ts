import { normalizePath, TFolder, type FileManager, type TAbstractFile, type Vault } from "obsidian";
import type { FigureVault } from "./figures";
import { isAllowedVaultPath } from "./payload-guard";

/**
 * Obsidian vault writes: `.md` / `.canvas` text with atomic replace so a
 * failed write leaves the previous file, plus figure `.png` images (the only
 * binary the plugin ever writes; never a PDF).
 */
export class ObsidianVaultWriter implements FigureVault {
  constructor(
    private readonly vault: Vault,
    private readonly fileManager: FileManager,
  ) {}

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

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized.toLowerCase().endsWith(".png")) {
      throw new Error("refusing to write a non-PNG binary");
    }
    const existing = this.vault.getAbstractFileByPath(normalized);
    if (existing && "extension" in existing) {
      await this.vault.modifyBinary(existing as never, data);
    } else {
      await this.vault.createBinary(normalized, data);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(normalizePath(from));
    if (!file || !("extension" in file)) {
      throw new Error("rename source is not a file");
    }
    await this.fileManager.renameFile(file, normalizePath(to));
  }

  async isEmptyFolder(path: string): Promise<boolean> {
    const found = this.vault.getAbstractFileByPath(normalizePath(path));
    return found instanceof TFolder && found.children.length === 0;
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

  async children(path: string): Promise<string[] | null> {
    const found = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!(found instanceof TFolder)) {
      return null;
    }
    return found.children.map((child) => child.path);
  }

  /** Moves to the user's configured trash (respects their deletion setting). */
  async remove(path: string): Promise<void> {
    const found = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!found) {
      return;
    }
    if (found instanceof TFolder && found.children.length > 0) {
      throw new Error("folder is not empty");
    }
    await this.fileManager.trashFile(found);
  }
}

export function isTFile(file: TAbstractFile | null): file is TAbstractFile & { extension: string } {
  return file != null && "extension" in file;
}
