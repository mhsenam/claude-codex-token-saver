import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordStats } from "./stats.js";
import type { ArtifactSlice, CompactionConfig } from "./types.js";

const artifactPattern = /^([a-zA-Z0-9_-]{1,64})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function sessionKey(sessionId: string): string {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) return sessionId;
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

export function sessionDirectory(root: string, sessionId: string): string {
  return path.join(root, sessionKey(sessionId));
}

function lines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
}

export class ArtifactStore {
  readonly root: string;
  private readonly retentionHours: number;
  private lastCleanup = 0;

  constructor(config: Pick<CompactionConfig, "retentionHours">, root?: string) {
    this.root = root ?? process.env.TOKEN_SAVER_DATA_DIR ?? path.join(os.homedir(), ".token-saver", "outputs");
    this.retentionHours = config.retentionHours;
  }

  async save(output: string, sessionId = "default"): Promise<string> {
    const session = sessionKey(sessionId);
    const id = randomUUID();
    const directory = path.join(this.root, session);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(directory, `${id}.log`), output, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await this.cleanupExpired();
    return `${session}.${id}`;
  }

  async reserve(sessionId = "default"): Promise<{ artifactId: string; filePath: string }> {
    const session = sessionKey(sessionId);
    const id = randomUUID();
    const directory = path.join(this.root, session);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return { artifactId: `${session}.${id}`, filePath: path.join(directory, `${id}.log`) };
  }

  async readSlice(artifactId: string, startLine = 1, maxLines = 200): Promise<ArtifactSlice> {
    const match = artifactPattern.exec(artifactId);
    if (!match) throw new Error("Invalid token-saver artifact ID");
    if (!Number.isInteger(startLine) || startLine < 1) throw new Error("startLine must be a positive integer");
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 1_000) {
      throw new Error("maxLines must be between 1 and 1000");
    }

    const filePath = path.join(this.root, match[1], `${match[2]}.log`);
    const output = await fs.readFile(filePath, "utf8");
    const allLines = lines(output);
    const start = Math.min(startLine - 1, allLines.length);
    const selected = allLines.slice(start, start + maxLines);
    const endLine = selected.length === 0 ? start : start + selected.length;
    await recordStats(this.root, { type: "retrieve", session: match[1], artifactId, startLine, maxLines });
    return {
      artifactId,
      startLine: start + 1,
      endLine,
      totalLines: allLines.length,
      text: selected.join("\n"),
    };
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < 60 * 60 * 1000) return;
    this.lastCleanup = now;
    const cutoff = now - this.retentionHours * 60 * 60 * 1000;

    let sessions;
    try {
      sessions = await fs.readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const session of sessions) {
      if (!session.isDirectory() || !/^[a-zA-Z0-9_-]{1,64}$/.test(session.name)) continue;
      const directory = path.join(this.root, session.name);
      const files = await fs.readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/^[0-9a-f-]{36}\.log$/.test(file.name)) continue;
        const filePath = path.join(directory, file.name);
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) await fs.rm(filePath);
      }
      const remaining = await fs.readdir(directory);
      if (remaining.length === 0) await fs.rmdir(directory);
    }
  }
}
