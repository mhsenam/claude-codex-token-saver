import { promises as fs } from "node:fs";
import path from "node:path";

export type StatsEvent =
  | { type: "compact"; session: string; kind: string; originalBytes: number; returnedBytes: number; artifactId: string }
  | { type: "dedup"; session: string; kind: string; originalBytes: number; returnedBytes: number; artifactId: string }
  | { type: "retrieve"; session: string; artifactId: string; startLine: number; maxLines: number }
  | { type: "rewrite"; session: string; kind: string; commandBytes: number };

interface RecordedEvent extends Record<string, unknown> {
  type: string;
  session: string;
  ts: number;
}

export const statsFileName = "stats.jsonl";

export function statsFilePath(root: string): string {
  return path.join(root, statsFileName);
}

function statsEnabled(): boolean {
  return process.env.TOKEN_SAVER_STATS !== "0";
}

export async function recordStats(root: string, event: StatsEvent): Promise<void> {
  if (!statsEnabled()) return;
  try {
    const recorded: RecordedEvent = { ...event, ts: Date.now() };
    await fs.appendFile(statsFilePath(root), `${JSON.stringify(recorded)}\n`, { encoding: "utf8" });
  } catch {
    // Stats must never break compaction or retrieval.
  }
}

export interface KindStats {
  compactedCount: number;
  dedupedCount: number;
  originalBytes: number;
  returnedBytes: number;
  dedupedOriginalBytes: number;
  dedupedReturnedBytes: number;
  rewrites: number;
}

export interface StatsSummary {
  sessions: number;
  compactions: number;
  dedupHits: number;
  retrievals: number;
  rewrites: number;
  originalBytes: number;
  returnedBytes: number;
  dedupedOriginalBytes: number;
  dedupedReturnedBytes: number;
  estimatedTokensSaved: number;
  estimatedReductionPercent: number;
  perKind: Record<string, KindStats>;
}

function emptyKindStats(): KindStats {
  return {
    compactedCount: 0,
    dedupedCount: 0,
    originalBytes: 0,
    returnedBytes: 0,
    dedupedOriginalBytes: 0,
    dedupedReturnedBytes: 0,
    rewrites: 0,
  };
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function summarizeStats(root: string): Promise<StatsSummary> {
  const summary: StatsSummary = {
    sessions: 0,
    compactions: 0,
    dedupHits: 0,
    retrievals: 0,
    rewrites: 0,
    originalBytes: 0,
    returnedBytes: 0,
    dedupedOriginalBytes: 0,
    dedupedReturnedBytes: 0,
    estimatedTokensSaved: 0,
    estimatedReductionPercent: 0,
    perKind: {},
  };

  let raw: string;
  try {
    raw = await fs.readFile(statsFilePath(root), "utf8");
  } catch {
    return summary;
  }

  const sessions = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: RecordedEvent;
    try {
      event = JSON.parse(line) as RecordedEvent;
    } catch {
      continue;
    }
    if (!event || typeof event.type !== "string") continue;
    sessions.add(String(event.session));

    if (event.type === "compact" || event.type === "dedup") {
      const kindStats = summary.perKind[String(event.kind)] ?? emptyKindStats();
      const originalBytes = asNumber((event as unknown as { originalBytes?: unknown }).originalBytes);
      const returnedBytes = asNumber((event as unknown as { returnedBytes?: unknown }).returnedBytes);
      if (event.type === "compact") {
        summary.compactions += 1;
        summary.originalBytes += originalBytes;
        summary.returnedBytes += returnedBytes;
        kindStats.compactedCount += 1;
        kindStats.originalBytes += originalBytes;
        kindStats.returnedBytes += returnedBytes;
      } else {
        summary.dedupHits += 1;
        summary.dedupedOriginalBytes += originalBytes;
        summary.dedupedReturnedBytes += returnedBytes;
        kindStats.dedupedCount += 1;
        kindStats.dedupedOriginalBytes += originalBytes;
        kindStats.dedupedReturnedBytes += returnedBytes;
      }
      summary.perKind[String(event.kind)] = kindStats;
    } else if (event.type === "retrieve") {
      summary.retrievals += 1;
    } else if (event.type === "rewrite") {
      summary.rewrites += 1;
      const kindStats = summary.perKind[String(event.kind) ?? "shell"] ?? emptyKindStats();
      kindStats.rewrites += 1;
      summary.perKind[String(event.kind) ?? "shell"] = kindStats;
    }
  }

  summary.sessions = sessions.size;
  const originalTotal = summary.originalBytes + summary.dedupedOriginalBytes;
  const returnedTotal = summary.returnedBytes + summary.dedupedReturnedBytes;
  summary.estimatedTokensSaved = Math.round((originalTotal - returnedTotal) / 4);
  summary.estimatedReductionPercent =
    originalTotal > 0 ? Math.round(((originalTotal - returnedTotal) / originalTotal) * 1000) / 10 : 0;
  return summary;
}

export function formatStatsSummary(summary: StatsSummary): string {
  const lines = [
    "[token-saver] session statistics (bytes/4 token estimates, not billed tokens)",
    `compactions: ${summary.compactions} | duplicates avoided: ${summary.dedupHits} | retrievals: ${summary.retrievals} | commands rewritten: ${summary.rewrites} | sessions: ${summary.sessions}`,
    `original: ${summary.originalBytes + summary.dedupedOriginalBytes} B | returned: ${summary.returnedBytes + summary.dedupedReturnedBytes} B | estimated reduction: ${summary.estimatedReductionPercent}% (~${summary.estimatedTokensSaved} tokens)`,
  ];
  const kinds = Object.entries(summary.perKind);
  if (kinds.length > 0) {
    lines.push(
      "per kind: " +
        kinds
          .map(([kind, stats]) => {
            const parts = [`${stats.compactedCount} compacted`];
            if (stats.dedupedCount > 0) parts.push(`${stats.dedupedCount} deduped`);
            if (stats.rewrites > 0) parts.push(`${stats.rewrites} rewritten`);
            return `${kind}: ${parts.join(", ")}`;
          })
          .join("; "),
    );
  }
  return lines.join("\n");
}
