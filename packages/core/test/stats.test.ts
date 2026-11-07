import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ArtifactStore,
  compactOutput,
  formatStatsSummary,
  recordStats,
  resolveConfig,
  statsFileName,
  summarizeStats,
} from "../src/index.js";

async function rootFor(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-stats-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("compactOutput records compact events that summarize correctly", async (t) => {
  const root = await rootFor(t);
  const store = new ArtifactStore(resolveConfig(), root);
  const config = resolveConfig();
  const verbose = () => Array.from({ length: 300 }, (_, index) => `log ${index}`).join("\n");

  const first = await compactOutput({ input: verbose(), kind: "test", sessionId: "stats-test", config, store });
  await compactOutput({ input: verbose(), kind: "test", sessionId: "stats-test", config, store });

  const summary = await summarizeStats(root);
  assert.equal(summary.compactions, 1);
  assert.equal(summary.dedupHits, 1);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.originalBytes, first.originalBytes);
  assert.ok(summary.originalBytes > summary.returnedBytes);
  assert.ok(summary.estimatedTokensSaved > 0);
  assert.ok(summary.estimatedReductionPercent > 50);
  assert.equal(summary.perKind.test.compactedCount, 1);
  assert.equal(summary.perKind.test.dedupedCount, 1);
});

test("retrieve and rewrite events are recorded", async (t) => {
  const root = await rootFor(t);
  const store = new ArtifactStore(resolveConfig(), root);
  const artifactId = await store.save("content", "stats-events");
  await store.readSlice(artifactId, 1, 5);
  await recordStats(root, { type: "rewrite", session: "stats-events", kind: "test", commandBytes: 42 });

  const summary = await summarizeStats(root);
  assert.equal(summary.retrievals, 1);
  assert.equal(summary.rewrites, 1);
  assert.equal(summary.perKind.test.rewrites, 1);
});

test("TOKEN_SAVER_STATS=0 disables recording", async (t) => {
  const root = await rootFor(t);
  process.env.TOKEN_SAVER_STATS = "0";
  t.after(() => delete process.env.TOKEN_SAVER_STATS);
  try {
    await recordStats(root, { type: "rewrite", session: "s", kind: "shell", commandBytes: 1 });
    const summary = await summarizeStats(root);
    assert.equal(summary.rewrites, 0);
    await assert.rejects(fs.access(path.join(root, statsFileName)));
  } finally {
    delete process.env.TOKEN_SAVER_STATS;
  }
});

test("formatStatsSummary renders a compact human-readable report", async (t) => {
  const root = await rootFor(t);
  await recordStats(root, { type: "compact", session: "fmt", kind: "shell", originalBytes: 4000, returnedBytes: 400, artifactId: "fmt.a" });
  await recordStats(root, { type: "dedup", session: "fmt", kind: "shell", originalBytes: 4000, returnedBytes: 300, artifactId: "fmt.a" });
  await recordStats(root, { type: "retrieve", session: "fmt", artifactId: "fmt.a", startLine: 1, maxLines: 10 });

  const report = formatStatsSummary(await summarizeStats(root));
  assert.match(report, /\[token-saver\] session statistics/);
  assert.match(report, /compactions: 1 \| duplicates avoided: 1 \| retrievals: 1/);
  assert.match(report, /shell: 1 compacted, 1 deduped/);
  assert.match(report, /estimated reduction: 9\d/);
});

test("summarizeStats on an empty store returns zeros without throwing", async (t) => {
  const root = await rootFor(t);
  const summary = await summarizeStats(root);
  assert.equal(summary.compactions, 0);
  assert.equal(summary.estimatedReductionPercent, 0);
});

test("evict events are summarized and rendered in the report", async (t) => {
  const root = await rootFor(t);
  await recordStats(root, { type: "compact", session: "e", kind: "shell", originalBytes: 50_000, returnedBytes: 5_000, artifactId: "e.a1" });
  await recordStats(root, { type: "evict", session: "e", artifactId: "e.a1", bytes: 4_850 });
  await recordStats(root, { type: "evict", session: "e", artifactId: "e.a2", bytes: 3_000 });

  const summary = await summarizeStats(root);
  assert.equal(summary.evictions, 2);
  assert.equal(summary.evictedBytes, 7_850);
  assert.equal(summary.compactions, 1);

  const report = formatStatsSummary(summary);
  assert.match(report, /evictions: 2 \| sessions: 1/);
  assert.match(report, /evicted from history: 7,?850 B/);
});
