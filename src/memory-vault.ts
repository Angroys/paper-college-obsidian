import type { VaultWriter } from "./sync-apply";

/**
 * In-memory vault used by unit tests and as the model for atomic replace:
 * previous file contents stay if a write throws.
 */
export class MemoryVault implements VaultWriter {
  files = new Map<string, string>();
  folders = new Set<string>();
  failNext = new Set<string>();
  writeLog: string[] = [];

  constructor(seed?: Record<string, string>) {
    if (seed) {
      for (const [path, content] of Object.entries(seed)) {
        this.files.set(path, content);
        this.addParentFolders(path);
      }
    }
  }

  addParentFolders(filePath: string): void {
    const parts = filePath.split("/");
    parts.pop();
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
      this.folders.add(cursor);
    }
  }

  failNextWrite(path: string): void {
    this.failNext.add(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async isFile(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async isFolder(path: string): Promise<boolean> {
    return this.folders.has(path) && !this.files.has(path);
  }

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    if (path.toLowerCase().endsWith(".pdf")) {
      throw new Error("refusing to write a PDF path");
    }
    const previous = this.files.get(path);
    if (this.failNext.has(path)) {
      this.failNext.delete(path);
      if (previous !== undefined) {
        this.files.set(path, previous);
      }
      throw new Error("write failed");
    }
    this.addParentFolders(path);
    this.files.set(path, content);
    this.writeLog.push(path);
  }

  async createFolder(path: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error("folder is a file");
    }
    this.folders.add(path);
    this.addParentFolders(path + "/.");
  }

  writtenPaths(): string[] {
    return Array.from(this.files.keys());
  }
}
