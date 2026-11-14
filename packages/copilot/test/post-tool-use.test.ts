import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Runs the shipped bundle (npm run build precedes npm test in the verification
// chain), mirroring scripts/smoke.mjs. The entry must fail open: unusable stdin
// never crashes the hook and never writes stdout.
async function dataDirFor(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "token-saver-copilot-entry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function runEntry(input: string, dataDir: string) {
  return spawnSync(process.execPath, ["packages/copilot/dist/post-tool-use.js"], {
    input,
    encoding: "utf8",
    env: { ...process.env, TOKEN_SAVER_DATA_DIR: dataDir },
  });
}

test("Copilot entry fails open on unparseable stdin", async (t) => {
  const dataDir = await dataDirFor(t);
  const run = runEntry("not json", dataDir);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
});

test("Copilot entry fails open on empty stdin", async (t) => {
  const dataDir = await dataDirFor(t);
  const run = runEntry("", dataDir);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
});
