import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { defaultConfig } from "../../core/src/index.js";
import { compactRead, compactRun, compactSearch, outputSlice } from "../src/tools.js";
import { testStore } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function projectFor(t: test.TestContext): Promise<string> {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-mcp-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await fs.rm(project, { recursive: true, force: true });
  });
  return project;
}

test("compact_read compacts large files and returns exact requested ranges", async (t) => {
  await projectFor(t);
  const store = testStore(path.join(process.cwd(), "artifacts"));
  const lines = Array.from({ length: 500 }, (_, index) => `line ${index + 1}`);
  await fs.writeFile("large.txt", lines.join("\n"));

  const compacted = await compactRead({ filePath: "large.txt", config: defaultConfig, store });
  assert.match(compacted, /\[token-saver\] read:/);
  const artifactId = /Full output: ([^;]+);/.exec(compacted)?.[1];
  assert.ok(artifactId);
  const recovered = await outputSlice({ artifactId: artifactId!, startLine: 499, maxLines: 2, store });
  assert.match(recovered, /line 499\nline 500/);

  const exact = await compactRead({ filePath: "large.txt", startLine: 20, maxLines: 2, config: defaultConfig, store });
  assert.equal(exact, "[large.txt: lines 20–21 of 500]\nline 20\nline 21");
  await assert.rejects(compactRead({ filePath: "../outside.txt", config: defaultConfig, store }), /inside the current project/);
});

test("compact_run reduces verbose output and preserves failure exit codes", async (t) => {
  await projectFor(t);
  const store = testStore(path.join(process.cwd(), "artifacts"));
  const result = await compactRun({
    command: "node -e \"for(let i=0;i<500;i++) console.log('line '+i)\"",
    config: defaultConfig,
    store,
  });
  assert.match(result, /\[token-saver\] shell:/);
  assert.match(result, /\[exit code: 0\]/);

  const failure = await compactRun({
    command: "node -e \"console.error('boom');process.exit(7)\"",
    config: defaultConfig,
    store,
  });
  assert.match(failure, /boom/);
  assert.match(failure, /\[exit code: 7\]/);
});

test("compact_search returns grouped, recoverable results when ripgrep is available", async (t) => {
  try {
    await execFileAsync("rg", ["--version"]);
  } catch {
    t.skip("ripgrep is not installed");
    return;
  }
  await projectFor(t);
  const store = testStore(path.join(process.cwd(), "artifacts"));
  await fs.mkdir("src");
  await fs.writeFile("src/matches.ts", Array.from({ length: 200 }, (_, index) => `const needle${index} = true;`).join("\n"));

  const result = await compactSearch({ pattern: "needle", paths: ["src"], config: defaultConfig, store });
  assert.match(result, /\[token-saver\] search:/);
  assert.match(result, /200 matches across 1 files/);
});

test("compact_search rejects paths outside the project before executing", async (t) => {
  await projectFor(t);
  const store = testStore(path.join(process.cwd(), "artifacts"));
  await assert.rejects(
    compactSearch({ pattern: "needle", paths: [".."], config: defaultConfig, store }),
    /inside the current project/,
  );
});
