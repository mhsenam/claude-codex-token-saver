// packages/core/src/pre-compact.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path2 from "node:path";

// packages/core/src/stats.ts
import path from "node:path";
var statsFileName = "stats.jsonl";
function statsFilePath(root) {
  return path.join(root, statsFileName);
}

// packages/core/src/pre-compact.ts
var preCompactInstructions = "Preserve the current objective, pending tasks, user constraints, modified file paths, exact errors, and decisions. Omit redundant tool output while retaining token-saver artifact IDs needed for retrieval.";
var defaultEvictionOptions = {
  minArtifacts: 3,
  minBytes: 1e5,
  maxCandidates: 5,
  retentionHours: 24
};
function defaultRoot() {
  return process.env.TOKEN_SAVER_DATA_DIR ?? path2.join(os.homedir(), ".token-saver", "outputs");
}
async function evictionCandidates(root, sessionId, maxCandidates = defaultEvictionOptions.maxCandidates, retentionHours = defaultEvictionOptions.retentionHours) {
  let raw;
  try {
    raw = await fs.readFile(statsFilePath(root), "utf8");
  } catch {
    return [];
  }
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1e3;
  const byArtifact = /* @__PURE__ */ new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event;
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
  return [...byArtifact.values()].sort((left, right) => left.ts - right.ts || right.bytes - left.bytes).slice(0, maxCandidates);
}
function evictionGuidance(candidates, options = {}) {
  const limits = { ...defaultEvictionOptions, ...options };
  if (candidates.length < limits.minArtifacts) return void 0;
  const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  if (totalBytes < limits.minBytes) return void 0;
  const list = candidates.map((candidate) => `${candidate.artifactId} (${Math.max(1, Math.round(candidate.bytes / 1024))} KB)`).join(", ");
  return `Token-saver eviction: this session stores ${candidates.length} compacted tool outputs (~${Math.round(totalBytes / 1024)} KB) as local artifacts: ${list}. When trimming older turns, replace such verbose tool results with a single placeholder line like "[token-saver artifact <id>: full output stored locally; retrieve exact lines with output_slice]" instead of summarizing them, oldest first. Preserve the newest 2 exchanges verbatim, keep every exact error message, and never evict the current turn.`;
}
async function buildPreCompactInstructions(options = {}) {
  if (process.env.TOKEN_SAVER_EVICTION === "0" || !options.sessionId) return preCompactInstructions;
  try {
    const retention = Number(process.env.TOKEN_SAVER_RETENTION_HOURS);
    const retentionHours = Number.isInteger(retention) && retention >= 1 && retention <= 720 ? retention : defaultEvictionOptions.retentionHours;
    const candidates = await evictionCandidates(
      options.root ?? defaultRoot(),
      options.sessionId,
      options.options?.maxCandidates,
      retentionHours
    );
    const guidance = evictionGuidance(candidates, options.options);
    return guidance ? `${preCompactInstructions}
${guidance}` : preCompactInstructions;
  } catch {
    return preCompactInstructions;
  }
}

// packages/core/src/pre-compact-main.ts
async function readStdinPayload() {
  if (!process.stdin.readable) return "";
  const chunks = [];
  const collect = (async () => {
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
      if (chunks.reduce((sum, part) => sum + part.length, 0) > 1e6) break;
    }
    return Buffer.concat(chunks).toString("utf8");
  })();
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(""), 1500);
    timer.unref();
  });
  return Promise.race([collect, timeout]);
}
async function main() {
  let instructions = preCompactInstructions;
  try {
    const payload = await readStdinPayload();
    if (payload) {
      const parsed = JSON.parse(payload);
      const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : void 0;
      instructions = await buildPreCompactInstructions({ sessionId });
    }
  } catch {
    instructions = preCompactInstructions;
  }
  process.stdout.write(instructions);
}
await main();
