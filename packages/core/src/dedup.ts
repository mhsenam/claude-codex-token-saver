import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sessionDirectory } from "./artifact-store.js";

export interface DedupEntry {
  artifactId: string;
  bytes: number;
  lines: number;
  ts: number;
}

const indexFileName = "dedup.json";

export function outputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export class DedupIndex {
  private readonly filePath: string;
  private readonly retentionHours: number;
  private entries: Record<string, DedupEntry> | undefined;

  constructor(root: string, sessionId: string, retentionHours: number) {
    this.filePath = path.join(sessionDirectory(root, sessionId), indexFileName);
    this.retentionHours = retentionHours;
  }

  async lookup(hash: string): Promise<DedupEntry | undefined> {
    const entries = await this.load();
    const entry = entries[hash];
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.retentionHours * 60 * 60 * 1000) return undefined;
    return entry;
  }

  async remember(hash: string, entry: DedupEntry): Promise<void> {
    const entries = await this.load();
    const cutoff = Date.now() - this.retentionHours * 60 * 60 * 1000;
    for (const key of Object.keys(entries)) {
      if (entries[key].ts < cutoff) delete entries[key];
    }
    entries[hash] = entry;
    try {
      await fs.writeFile(`${this.filePath}.tmp`, JSON.stringify(entries), { encoding: "utf8", mode: 0o600 });
      await fs.rename(`${this.filePath}.tmp`, this.filePath);
    } catch {
      // A failed index write must not break compaction.
    }
  }

  private async load(): Promise<Record<string, DedupEntry>> {
    if (this.entries) return this.entries;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, DedupEntry>;
      this.entries = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      this.entries = {};
    }
    return this.entries;
  }
}
