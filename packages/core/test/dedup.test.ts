import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore, compactOutput, resolveConfig } from "../src/index.js";
import { DedupIndex, outputHash } from "../src/dedup.js";

async function storeFor(t: test.TestContext): Promise<ArtifactStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-dedup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new ArtifactStore(resolveConfig(), root);
}

const verbose = () => Array.from({ length: 300 }, (_, index) => `identical log ${index}`).join("\n");

test("identical repeated output returns a stub pointing at the first artifact", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();

  const first = await compactOutput({ input: verbose(), kind: "shell", sessionId: "dedup-test", config, store });
  assert.equal(first.deduped, undefined);
  assert.ok(first.artifactId);

  const second = await compactOutput({ input: verbose(), kind: "shell", sessionId: "dedup-test", config, store });
  assert.equal(second.deduped, true);
  assert.equal(second.artifactId, first.artifactId);
  assert.match(second.text, /\[token-saver\] duplicate: identical output was already stored/);
  assert.match(second.text, new RegExp(`artifactId=${first.artifactId}`));
  assert.ok(second.returnedBytes < first.returnedBytes / 2, "stub should be much smaller than the full compaction");
  assert.match(second.text, /identical log 0/);
  assert.match(second.text, /use output_slice to retrieve any line range/);

  const slice = await store.readSlice(first.artifactId!);
  assert.ok(slice.totalLines >= 300);
});

test("dedup can be disabled through configuration", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig({ dedup: false });

  const first = await compactOutput({ input: verbose(), kind: "shell", sessionId: "dedup-off", config, store });
  const second = await compactOutput({ input: verbose(), kind: "shell", sessionId: "dedup-off", config, store });
  assert.equal(second.deduped, undefined);
  assert.notEqual(second.artifactId, first.artifactId);
});

test("different content is never deduplicated", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();
  const other = () => Array.from({ length: 300 }, (_, index) => `different log ${index}`).join("\n");

  const first = await compactOutput({ input: verbose(), kind: "shell", sessionId: "dedup-diff", config, store });
  const different = await compactOutput({ input: other(), kind: "shell", sessionId: "dedup-diff", config, store });
  assert.equal(different.deduped, undefined);
  assert.notEqual(different.artifactId, first.artifactId);
});

test("small outputs below the compaction threshold are never deduplicated", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();
  const small = "same small output";
  const first = await compactOutput({ input: small, kind: "shell", sessionId: "dedup-small", config, store });
  const second = await compactOutput({ input: small, kind: "shell", sessionId: "dedup-small", config, store });
  assert.equal(first.compacted, false);
  assert.equal(second.compacted, false);
  assert.equal(second.text, small);
});

test("the dedup index survives artifact retention cleanup", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-dedup-clean-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = resolveConfig();
  const store = new ArtifactStore(config, root);

  const first = await compactOutput({ input: verbose(), kind: "shell", sessionId: "clean-test", config, store });
  const sessionDir = path.join(root, first.artifactId!.split(".")[0]);
  await store.save("trigger cleanup", "clean-test");

  const files = await fs.readdir(sessionDir);
  assert.ok(files.includes("dedup.json"), "dedup.json must not be removed by retention cleanup");

  const index = new DedupIndex(root, "clean-test", config.retentionHours);
  const entry = await index.lookup(outputHash(verbose()));
  assert.ok(entry, "index entry should remain readable after cleanup runs");
});

test("index entries expire after the retention window", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-dedup-expire-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const index = new DedupIndex(root, "expire-test", 1);
  const hash = outputHash("anything");
  await index.remember(hash, { artifactId: "expire-test.11111111-1111-4111-8111-111111111111", bytes: 10, lines: 1, ts: Date.now() - 2 * 60 * 60 * 1000 });
  assert.equal(await index.lookup(hash), undefined);
});
