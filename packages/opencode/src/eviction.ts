import { promises as fs } from "node:fs";
import path from "node:path";
import { recordStats } from "../../core/src/index.js";

/**
 * Continuous history eviction for opencode, driven by the
 * `experimental.chat.messages.transform` hook (the one place opencode exposes
 * the full mutable message list before every LLM call).
 *
 * Only token-saver-compacted results are evicted: their full text already
 * lives in a local artifact, so replacing the preview with a placeholder
 * loses nothing that output_slice cannot recover. Everything else passes
 * through untouched.
 */

const artifactIdPattern = /^[a-zA-Z0-9_-]{1,64}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const compactedHeaderPattern =
  /\[token-saver\] \w+: \d+ lines\/\d+ B → \d+ lines\/\d+ B\. Full output: ([a-zA-Z0-9_-]+\.[0-9a-f-]{36});/;

const duplicateHeaderPattern = /\[token-saver\] duplicate:[^\n]*artifactId=([a-zA-Z0-9_-]+\.[0-9a-f-]{36})/;

/** Results smaller than this are left alone even when artifact-backed. */
const minCandidateBytes = 1_000;

export function placeholder(artifactId: string): string {
  return `[token-saver] evicted: this result's full output is stored locally (artifactId=${artifactId}); retrieve exact lines with output_slice.`;
}

/**
 * Extract the artifact ID from a compacted or duplicate-stub result header.
 * Returns undefined for anything else (including results too small to be
 * worth rewriting).
 */
export function parseArtifactId(output: unknown): string | undefined {
  if (typeof output !== "string" || output.length < minCandidateBytes) return undefined;
  return compactedHeaderPattern.exec(output)?.[1] ?? duplicateHeaderPattern.exec(output)?.[1];
}

export interface ToolPartLike {
  type: string;
  sessionID: string;
  state: { status: string; output?: unknown };
}

export interface EvictionDeps {
  artifactExists(artifactId: string): Promise<boolean>;
  recordEvict(session: string, artifactId: string, bytes: number): Promise<void>;
}

export interface EvictionOptions {
  /** Keep this many of the most recent artifact-backed results verbatim. */
  keepRecent: number;
  /** Rewrite nothing unless the batch recovers at least this many bytes. */
  minNetSavings: number;
}

export const defaultEvictionOptions: EvictionOptions = {
  keepRecent: 3,
  minNetSavings: 6_000,
};

export function evictionOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): EvictionOptions | undefined {
  if (env.TOKEN_SAVER_EVICTION === "0") return undefined;
  const integer = (value: string | undefined, fallback: number, min: number, max: number): number => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  return {
    keepRecent: integer(env.TOKEN_SAVER_EVICTION_KEEP_RECENT, defaultEvictionOptions.keepRecent, 0, 100),
    minNetSavings: integer(env.TOKEN_SAVER_EVICTION_MIN_NET_SAVINGS, defaultEvictionOptions.minNetSavings, 0, 1_000_000),
  };
}

interface Candidate {
  sessionID: string;
  state: { output?: unknown };
  artifactId: string;
  savings: number;
}

/**
 * Replace artifact-backed tool results older than `keepRecent` with one-line
 * placeholders. Batches: when the recovered bytes do not clear
 * `minNetSavings`, nothing is rewritten so the prompt cache stays intact.
 * Returns the number of evicted results and the bytes removed from the
 * request.
 */
export async function evictMessages(
  messages: { parts?: unknown[] }[],
  options: EvictionOptions,
  deps: EvictionDeps,
): Promise<{ evicted: number; bytesSaved: number }> {
  const candidates: Candidate[] = [];
  for (const message of messages ?? []) {
    for (const part of message.parts ?? []) {
      const toolPart = part as ToolPartLike | undefined;
      if (!toolPart || toolPart.type !== "tool") continue;
      if (toolPart.state?.status !== "completed") continue;
      const output = toolPart.state.output;
      if (typeof output !== "string") continue;
      const artifactId = parseArtifactId(output);
      if (!artifactId) continue;
      candidates.push({
        sessionID: toolPart.sessionID,
        state: toolPart.state,
        artifactId,
        savings: Buffer.byteLength(output) - Buffer.byteLength(placeholder(artifactId)),
      });
    }
  }

  const evictable = candidates.slice(0, Math.max(0, candidates.length - options.keepRecent));
  if (evictable.length === 0) return { evicted: 0, bytesSaved: 0 };

  const verified: Candidate[] = [];
  let totalSavings = 0;
  for (const candidate of evictable) {
    if (!artifactIdPattern.test(candidate.artifactId)) continue;
    if (!(await deps.artifactExists(candidate.artifactId))) continue;
    verified.push(candidate);
    totalSavings += candidate.savings;
  }
  if (verified.length === 0 || totalSavings < options.minNetSavings) {
    return { evicted: 0, bytesSaved: 0 };
  }

  for (const candidate of verified) {
    candidate.state.output = placeholder(candidate.artifactId);
    await deps.recordEvict(candidate.sessionID, candidate.artifactId, candidate.savings);
  }
  return { evicted: verified.length, bytesSaved: totalSavings };
}

/** Artifact-path existence check against the shared artifact store root. */
export function artifactExistsFactory(root: string): (artifactId: string) => Promise<boolean> {
  return async (artifactId: string) => {
    try {
      await fs.access(path.join(root, `${artifactId.replace(".", path.sep)}.log`));
      return true;
    } catch {
      return false;
    }
  };
}

export function recordEvictFactory(root: string): EvictionDeps["recordEvict"] {
  return (session: string, artifactId: string, bytes: number) =>
    recordStats(root, { type: "evict", session, artifactId, bytes });
}
