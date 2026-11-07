import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPreCompactInstructions,
  compactText,
  configFromEnv,
  evictionCandidates,
  evictionGuidance,
  policyConfig,
  preCompactInstructions,
  recordStats,
  resolveConfig,
} from "../src/index.js";

test("configFromEnv parses per-policy budget variables", () => {
  const config = configFromEnv({
    TOKEN_SAVER_MAX_LINES_TEST: "200",
    TOKEN_SAVER_MAX_BYTES_SHELL: "10000",
    TOKEN_SAVER_HEAD_LINES_SEARCH: "0",
    TOKEN_SAVER_TAIL_LINES_READ: "30",
    TOKEN_SAVER_MAX_LINES_SEARCH: "not-a-number",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(config.policyBudgets.test, { maxOutputLines: 200 });
  assert.deepEqual(config.policyBudgets.shell, { maxOutputBytes: 10_000 });
  assert.deepEqual(config.policyBudgets.search, { headLines: 0 });
  assert.deepEqual(config.policyBudgets.read, { tailLines: 30 });
  // global budgets are untouched
  assert.equal(config.maxOutputLines, 120);
  assert.equal(config.maxOutputBytes, 30_000);
});

test("configFromEnv without policy variables produces no overrides", () => {
  const config = configFromEnv({} as NodeJS.ProcessEnv);
  assert.deepEqual(config.policyBudgets, {});
});

test("resolveConfig keeps only valid kinds and non-empty overrides", () => {
  const config = resolveConfig({
    policyBudgets: { test: { maxOutputLines: 300 }, read: {} },
  });
  assert.deepEqual(Object.keys(config.policyBudgets), ["test"]);
});

test("policyConfig layers the kind override over the global budget", () => {
  const base = resolveConfig({ policyBudgets: { shell: { maxOutputLines: 40, tailLines: 10 } } });
  const shell = policyConfig(base, "shell");
  assert.equal(shell.maxOutputLines, 40);
  assert.equal(shell.tailLines, 10);
  assert.equal(shell.maxOutputBytes, base.maxOutputBytes);
  const test = policyConfig(base, "test");
  assert.equal(test.maxOutputLines, base.maxOutputLines);
});

test("a tight per-policy budget compacts output the global budget would keep", () => {
  const config = resolveConfig({ policyBudgets: { shell: { maxOutputLines: 20 } } });
  const input = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n");

  assert.equal(compactText(input, "shell", resolveConfig()).compacted, false);
  const result = compactText(input, "shell", config);
  assert.equal(result.compacted, true);
  assert.match(result.text, /\[… original lines/);
});

test("a generous per-policy budget keeps test output the global budget would compact", () => {
  const config = resolveConfig({ policyBudgets: { test: { maxOutputLines: 1_000 } } });
  const input = Array.from({ length: 200 }, (_, index) => `running case ${index + 1}`).join("\n");

  assert.equal(compactText(input, "test", resolveConfig()).compacted, true);
  assert.equal(compactText(input, "test", config).compacted, false);
});

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-eviction-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("evictionCandidates aggregates session artifacts oldest first", async (t) => {
  const root = await temporaryDirectory(t);
  await recordStats(root, {
    type: "compact",
    session: "s1",
    kind: "shell",
    originalBytes: 60_000,
    returnedBytes: 0,
    artifactId: "s1.aaaa",
  });
  await recordStats(root, {
    type: "compact",
    session: "s1",
    kind: "test",
    originalBytes: 50_000,
    returnedBytes: 0,
    artifactId: "s1.bbbb",
  });
  await recordStats(root, {
    type: "dedup",
    session: "s1",
    kind: "shell",
    originalBytes: 60_000,
    returnedBytes: 0,
    artifactId: "s1.aaaa",
  });
  await recordStats(root, {
    type: "compact",
    session: "other",
    kind: "shell",
    originalBytes: 999_999,
    returnedBytes: 0,
    artifactId: "other.cccc",
  });
  await recordStats(root, { type: "retrieve", session: "s1", artifactId: "s1.aaaa", startLine: 1, maxLines: 5 });

  const candidates = await evictionCandidates(root, "s1");
  assert.deepEqual(
    candidates.map((candidate) => candidate.artifactId),
    ["s1.aaaa", "s1.bbbb"],
  );
  assert.equal(candidates[0].bytes, 60_000);
});

test("evictionGuidance only activates past both thresholds", () => {
  const small = [
    { artifactId: "s1.aaaa", bytes: 10_000, ts: 1 },
    { artifactId: "s1.bbbb", bytes: 20_000, ts: 2 },
  ];
  assert.equal(evictionGuidance(small), undefined);

  const few = [
    { artifactId: "s1.aaaa", bytes: 90_000, ts: 1 },
    { artifactId: "s1.bbbb", bytes: 20_000, ts: 2 },
  ];
  assert.equal(evictionGuidance(few), undefined);

  const enough = [
    { artifactId: "s1.aaaa", bytes: 90_000, ts: 1 },
    { artifactId: "s1.bbbb", bytes: 60_000, ts: 2 },
    { artifactId: "s1.cccc", bytes: 30_000, ts: 3 },
  ];
  const guidance = evictionGuidance(enough);
  assert.match(guidance ?? "", /3 compacted tool outputs \(~176 KB\)/);
  assert.match(guidance ?? "", /s1\.aaaa \(88 KB\), s1\.bbbb \(59 KB\), s1\.cccc \(29 KB\)/);
  assert.match(guidance ?? "", /output_slice/);
});

test("buildPreCompactInstructions appends guidance for qualifying sessions and fails open", async (t) => {
  const root = await temporaryDirectory(t);
  for (let index = 0; index < 3; index += 1) {
    await recordStats(root, {
      type: "compact",
      session: "busy",
      kind: "shell",
      originalBytes: 40_000,
      returnedBytes: 0,
      artifactId: `busy.artifact-${index}`,
    });
  }

  const withGuidance = await buildPreCompactInstructions({ sessionId: "busy", root });
  assert.match(withGuidance, /^Preserve the current objective/);
  assert.match(withGuidance, /Token-saver eviction/);

  const quiet = await buildPreCompactInstructions({ sessionId: "empty", root });
  assert.equal(quiet, preCompactInstructions);

  const missingRoot = await buildPreCompactInstructions({ sessionId: "busy", root: path.join(root, "absent") });
  assert.equal(missingRoot, preCompactInstructions);

  const previous = process.env.TOKEN_SAVER_EVICTION;
  process.env.TOKEN_SAVER_EVICTION = "0";
  try {
    const disabled = await buildPreCompactInstructions({ sessionId: "busy", root });
    assert.equal(disabled, preCompactInstructions);
  } finally {
    if (previous === undefined) delete process.env.TOKEN_SAVER_EVICTION;
    else process.env.TOKEN_SAVER_EVICTION = previous;
  }
});
