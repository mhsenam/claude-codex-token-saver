import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { statsFilePath } from "./stats.js";

export const preCompactInstructions =
  "Preserve the current objective, pending tasks, user constraints, modified file paths, exact errors, and decisions. Omit redundant tool output while retaining token-saver artifact IDs needed for retrieval.";

export interface EvictionCandidate {
  artifactId: string;
  bytes: number;
  ts: number;
}

export interface EvictionGuidanceOptions {
  /** Skip guidance unless the session stores at least this many compacted artifacts. */
  minArtifacts?: number;
  /** Skip guidance unless compacted artifacts total at least this many original bytes. */
  minBytes?: number;
  /** At most this many oldest artifacts are named as eviction candidates. */
  maxCandidates?: number;
  /** Ignore artifacts recorded longer ago than this many hours (they may have expired). */
  retentionHours?: number;
}

const defaultEvictionOptions: Required<EvictionGuidanceOptions> = {
  minArtifacts: 3,
  minBytes: 100_000,
  maxCandidates: 5,
  retentionHours: 24,
};

function defaultRoot(): string {
  return process.env.TOKEN_SAVER_DATA_DIR ?? path.join(os.homedir(), ".token-saver", "outputs");
}

/**
 * Collect the session's compacted artifacts from stats.jsonl, oldest first.
 * Byte-identical duplicates reference the earlier artifact and count toward it.
 */
export async function evictionCandidates(
  root: string,
  sessionId: string,
  maxCandidates = defaultEvictionOptions.maxCandidates,
  retentionHours = defaultEvictionOptions.retentionHours,
): Promise<EvictionCandidate[]> {
  let raw: string;
  try {
    raw = await fs.readFile(statsFilePath(root), "utf8");
  } catch {
    return [];
  }

  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const byArtifact = new Map<string, EvictionCandidate>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: { type?: unknown; session?: unknown; artifactId?: unknown; originalBytes?: unknown; ts?: unknown };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "compact" && event.type !== "dedup") continue;
    if (event.session !== sessionId) continue;
    if (typeof event.artifactId !== "string" || event.artifactId.length === 0) continue;
    const ts = typeof event.ts === "number" ? event.ts : 0;
    if (ts !== 0 && ts < cutoff) continue;
    const bytes = typeof event.originalBytes === "number" ? event.originalBytes : 0;
    const existing = byArtifact.get(event.artifactId);
    if (existing) {
      existing.bytes = Math.max(existing.bytes, bytes);
      existing.ts = Math.min(existing.ts, ts || existing.ts);
    } else {
      byArtifact.set(event.artifactId, { artifactId: event.artifactId, bytes, ts });
    }
  }

  return [...byArtifact.values()]
    .sort((left, right) => left.ts - right.ts || right.bytes - left.bytes)
    .slice(0, maxCandidates);
}

/**
 * Instructions for the host's own context compactor: verbose tool results from
 * evictable artifacts may collapse to a one-line placeholder, because the full
 * text stays recoverable through output_slice. Returns undefined when the
 * session has not stored enough output to make eviction worthwhile.
 */
export function evictionGuidance(
  candidates: EvictionCandidate[],
  options: EvictionGuidanceOptions = {},
): string | undefined {
  const limits = { ...defaultEvictionOptions, ...options };
  if (candidates.length < limits.minArtifacts) return undefined;
  const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  if (totalBytes < limits.minBytes) return undefined;

  const list = candidates
    .map((candidate) => `${candidate.artifactId} (${Math.max(1, Math.round(candidate.bytes / 1024))} KB)`)
    .join(", ");
  return (
    `Token-saver eviction: this session stores ${candidates.length} compacted tool outputs (~${Math.round(totalBytes / 1024)} KB) as local artifacts: ${list}. ` +
    "When trimming older turns, replace such verbose tool results with a single placeholder line like " +
    '"[token-saver artifact <id>: full output stored locally; retrieve exact lines with output_slice]" instead of summarizing them, ' +
    "oldest first. Preserve the newest 2 exchanges verbatim, keep every exact error message, and never evict the current turn."
  );
}

export interface BuildPreCompactOptions {
  sessionId?: string;
  root?: string;
  options?: EvictionGuidanceOptions;
}

/**
 * Full PreCompact guidance: the static base instructions plus, when the
 * session has stored enough compacted output, artifact eviction guidance.
 * Any failure falls back to the static base text.
 */
export async function buildPreCompactInstructions(options: BuildPreCompactOptions = {}): Promise<string> {
  if (process.env.TOKEN_SAVER_EVICTION === "0" || !options.sessionId) return preCompactInstructions;
  try {
    const retention = Number(process.env.TOKEN_SAVER_RETENTION_HOURS);
    const retentionHours =
      Number.isInteger(retention) && retention >= 1 && retention <= 720
        ? retention
        : defaultEvictionOptions.retentionHours;
    const candidates = await evictionCandidates(
      options.root ?? defaultRoot(),
      options.sessionId,
      options.options?.maxCandidates,
      retentionHours,
    );
    const guidance = evictionGuidance(candidates, options.options);
    return guidance ? `${preCompactInstructions}\n${guidance}` : preCompactInstructions;
  } catch {
    return preCompactInstructions;
  }
}
