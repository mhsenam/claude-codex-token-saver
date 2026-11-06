import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ArtifactStore,
  compactOutput,
  compactText,
  configFromEnv,
  defaultConfig,
  resolveConfig,
} from "../src/index.js";

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-core-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("small output passes through unchanged", () => {
  const result = compactText("two\nlines", "shell", defaultConfig);
  assert.equal(result.text, "two\nlines");
  assert.equal(result.compacted, false);
});

test("shell output is reduced and the exact original remains retrievable", async (t) => {
  const store = new ArtifactStore(defaultConfig, await temporaryDirectory(t));
  const original = Array.from({ length: 1_000 }, (_, index) => `line ${index + 1}`).join("\n");
  const result = await compactOutput({ input: original, kind: "shell", sessionId: "session", config: defaultConfig, store });

  assert.equal(result.compacted, true);
  assert.ok(result.returnedBytes < result.originalBytes / 5);
  assert.match(result.text, /line 1/);
  assert.match(result.text, /line 1000/);
  assert.ok(result.artifactId);
  const slice = await store.readSlice(result.artifactId!, 998, 3);
  assert.equal(slice.text, "line 998\nline 999\nline 1000");
  assert.equal(slice.totalLines, 1_000);
});

test("test compaction preserves failures in the middle and strips ANSI from the preview", async (t) => {
  const store = new ArtifactStore(defaultConfig, await temporaryDirectory(t));
  const lines = Array.from({ length: 1_000 }, (_, index) => `running test case ${index + 1}`);
  lines[499] = "\x1b[31mFAIL: middle assertion failed\x1b[0m";
  const result = await compactOutput({ input: lines.join("\n"), kind: "test", config: defaultConfig, store });

  assert.match(result.text, /FAIL: middle assertion failed/);
  assert.doesNotMatch(result.text, /\x1b/);
  const original = await store.readSlice(result.artifactId!, 500, 1);
  assert.equal(original.text, lines[499]);
});

test("search results are capped per file with a complete match count", () => {
  const config = resolveConfig({ searchPerFile: 2, maxOutputLines: 20, headLines: 5, tailLines: 5 });
  const input = Array.from({ length: 4 }, (_, file) =>
    Array.from({ length: 10 }, (_, line) => `src/file-${file}.ts:${line + 1}:const needle = true;`).join("\n"),
  ).join("\n");
  const result = compactText(input, "search", config);

  assert.match(result.text, /40 matches across 4 files/);
  assert.match(result.text, /8 additional matches omitted/);
  assert.ok(result.returnedBytes < result.originalBytes);
});

test("long Unicode lines are truncated without dangling surrogate pairs", () => {
  const config = resolveConfig({ maxLineLength: 80, maxOutputBytes: 1_000 });
  const result = compactText(`start ${"🙂".repeat(200)} end`, "shell", config);
  assert.equal(result.compacted, true);
  assert.doesNotMatch(result.text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
});

test("disabled tools and explicit configuration pass through", () => {
  const config = resolveConfig({ enabledTools: ["read"] });
  const input = "x".repeat(5_000);
  assert.equal(compactText(input, "shell", config).compacted, false);
  assert.equal(compactText(input, "read", config).compacted, true);
});

test("artifact IDs reject traversal and malformed values", async (t) => {
  const store = new ArtifactStore(defaultConfig, await temporaryDirectory(t));
  await assert.rejects(store.readSlice("../../secret", 1, 10), /Invalid token-saver artifact ID/);
  await assert.rejects(store.readSlice("default.not-a-uuid", 1, 10), /Invalid token-saver artifact ID/);
});

test("environment configuration rejects invalid values", () => {
  const config = configFromEnv({
    TOKEN_SAVER_TOOLS: "shell,search,invalid",
    TOKEN_SAVER_MAX_LINES: "-4",
    TOKEN_SAVER_TAIL_LINES: "25",
  });
  assert.deepEqual(config.enabledTools, ["shell", "search"]);
  assert.equal(config.maxOutputLines, defaultConfig.maxOutputLines);
  assert.equal(config.tailLines, 25);
});
