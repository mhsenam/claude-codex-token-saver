import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore, resolveConfig } from "../../core/src/index.js";
import { handleQoderPostToolUse } from "../src/handler.js";

async function storeFor(t: test.TestContext): Promise<ArtifactStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-qoder-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new ArtifactStore(resolveConfig(), root);
}

test("Qoder PostToolUse replaces verbose output in the original shape and retains exit metadata", async (t) => {
  const store = await storeFor(t);
  const output = Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n");
  const result = await handleQoderPostToolUse({
    session_id: "qoder-test",
    tool_use_id: "toolu_01ABC123",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { stdout: output, exit_code: 2 },
  }, resolveConfig(), store);

  const hook = result?.hookSpecificOutput as {
    hookEventName: string;
    updatedToolOutput: { stdout: string; stderr: string; exit_code: number };
  };
  assert.equal(hook.hookEventName, "PostToolUse");
  assert.match(hook.updatedToolOutput.stdout, /\[token-saver\] test:/);
  assert.equal(hook.updatedToolOutput.stderr, "");
  assert.equal(hook.updatedToolOutput.exit_code, 2, "unrelated fields must be preserved");
  assert.match(hook.updatedToolOutput.stdout, /\[exit code: 2\]/);
});

test("run_in_terminal verbose output is compacted with the shell policy", async (t) => {
  const store = await storeFor(t);
  const output = Array.from({ length: 300 }, (_, index) => `progress ${index}`).join("\n");
  const result = await handleQoderPostToolUse({
    session_id: "qoder-test",
    tool_name: "run_in_terminal",
    tool_input: { command: "cargo build --release" },
    tool_response: output,
  }, resolveConfig(), store);
  const updated = (result?.hookSpecificOutput as { updatedToolOutput: string }).updatedToolOutput;
  assert.match(updated, /\[token-saver\] shell:/);
});

test("small output and explicit ranges are not changed", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();
  const large = "x".repeat(5_000);
  assert.equal(await handleQoderPostToolUse({
    tool_name: "Bash",
    tool_input: { command: "pwd" },
    tool_response: "ok",
  }, config, store), undefined);
  assert.equal(await handleQoderPostToolUse({
    tool_name: "Read",
    tool_input: { file_path: "a.ts", offset: 10, limit: 20 },
    tool_response: large,
  }, config, store), undefined);
});
