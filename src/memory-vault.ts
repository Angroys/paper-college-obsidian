import type { FigureVault } from "./figures";

/**
 * In-memory vault used by unit tests and as the model for atomic replace:
 * previous file contents stay if a write throws.
 */
export class MemoryVault implements FigureVault {
  files = new Map<string, string>();
  binaries = new Map<string, ArrayBuffer>();
  folders = new Set<string>();
  failNext = new Set<string>();
  writeLog: string[] = [];
  removeLog: string[] = [];

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
    return this.files.has(path) || this.binaries.has(path) || this.folders.has(path);
  }

  async isFile(path: string): Promise<boolean> {
    return this.files.has(path) || this.binaries.has(path);
  }

  async isFolder(path: string): Promise<boolean> {
    return this.folders.has(path) && !this.files.has(path) && !this.binaries.has(path);
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

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    if (!path.toLowerCase().endsWith(".png")) {
      throw new Error("refusing to write a non-PNG binary");
    }
    if (this.failNext.has(path)) {
      this.failNext.delete(path);
      throw new Error("write failed");
    }
    this.addParentFolders(path);
    this.binaries.set(path, data);
    this.writeLog.push(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const data = this.binaries.get(from);
    if (data === undefined || (await this.exists(to))) {
      throw new Error("rename failed");
    }
    this.binaries.delete(from);
    this.addParentFolders(to);
    this.binaries.set(to, data);
  }

  async isEmptyFolder(path: string): Promise<boolean> {
    const prefix = `${path}/`;
    const all = [
      ...Array.from(this.files.keys()),
      ...Array.from(this.binaries.keys()),
      ...Array.from(this.folders),
    ];
    return !all.some((entry) => entry.startsWith(prefix));
  }

  async createFolder(path: string): Promise<void> {
    if (this.files.has(path) || this.binaries.has(path)) {
      throw new Error("folder is a file");
    }
    this.folders.add(path);
    this.addParentFolders(path + "/.");
  }

  async children(path: string): Promise<string[] | null> {
    if (!(await this.isFolder(path))) {
      return null;
    }
    const prefix = `${path}/`;
    const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/");
    return [
      ...Array.from(this.folders).filter(direct),
      ...Array.from(this.files.keys()).filter(direct),
      ...Array.from(this.binaries.keys()).filter(direct),
    ].sort();
  }

  async remove(path: string): Promise<void> {
    if (this.files.delete(path) || this.binaries.delete(path)) {
      this.removeLog.push(path);
      return;
    }
    if (this.folders.has(path)) {
      if (!(await this.isEmptyFolder(path))) {
        throw new Error("folder is not empty");
      }
      this.folders.delete(path);
      this.removeLog.push(path);
      return;
    }
    throw new Error("no such path");
  }

  writtenPaths(): string[] {
    return Array.from(this.files.keys());
  }
}
