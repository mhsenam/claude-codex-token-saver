import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore, defaultConfig } from "../../core/src/index.js";
import { handleQoderPostToolUse } from "../src/handler.js";

async function storeFor(t: test.TestContext): Promise<ArtifactStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-qoder-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new ArtifactStore(defaultConfig, root);
}

test("Qoder PostToolUse replaces verbose output and retains exit metadata", async (t) => {
  const store = await storeFor(t);
  const output = Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n");
  const result = await handleQoderPostToolUse({
    session_id: "qoder-test",
    tool_use_id: "toolu_01ABC123",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { stdout: output, exit_code: 2 },
  }, defaultConfig, store);

  const hook = result?.hookSpecificOutput as { hookEventName: string; updatedToolOutput: string };
  assert.equal(hook.hookEventName, "PostToolUse");
  assert.match(hook.updatedToolOutput, /\[token-saver\] test:/);
  assert.match(hook.updatedToolOutput, /\[exit code: 2\]/);
});

test("run_in_terminal verbose output is compacted with the shell policy", async (t) => {
  const store = await storeFor(t);
  const output = Array.from({ length: 300 }, (_, index) => `progress ${index}`).join("\n");
  const result = await handleQoderPostToolUse({
    session_id: "qoder-test",
    tool_name: "run_in_terminal",
    tool_input: { command: "cargo build --release" },
    tool_response: output,
  }, defaultConfig, store);
  assert.match((result?.hookSpecificOutput as { updatedToolOutput: string }).updatedToolOutput, /\[token-saver\] shell:/);
});

test("explicit file ranges and small output are not changed", async (t) => {
  const store = await storeFor(t);
  const large = "x".repeat(5_000);
  assert.equal(await handleQoderPostToolUse({
    tool_name: "Read",
    tool_input: { file_path: "a.ts", offset: 10, limit: 20 },
    tool_response: large,
  }, defaultConfig, store), undefined);
  assert.equal(await handleQoderPostToolUse({
    tool_name: "Bash",
    tool_input: { command: "pwd" },
    tool_response: "ok",
  }, defaultConfig, store), undefined);
});
