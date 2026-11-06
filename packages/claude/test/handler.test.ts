import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore, resolveConfig } from "../../core/src/index.js";
import { extractToolOutput, handlePostToolUse } from "../src/handler.js";

async function storeFor(t: test.TestContext): Promise<ArtifactStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-claude-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new ArtifactStore(resolveConfig(), root);
}

test("Claude PostToolUse replaces verbose output in the original shape and retains exit metadata", async (t) => {
  const store = await storeFor(t);
  const output = Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n");
  const result = await handlePostToolUse({
    session_id: "claude-test",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { content: output, exit_code: 2 },
  }, resolveConfig(), store);

  const hook = result?.hookSpecificOutput as {
    hookEventName: string;
    updatedToolOutput: { content: string; exit_code: number };
  };
  assert.equal(hook.hookEventName, "PostToolUse");
  assert.match(hook.updatedToolOutput.content, /\[token-saver\] test:/);
  assert.match(hook.updatedToolOutput.content, /\[exit code: 2\]/);
  assert.equal(hook.updatedToolOutput.exit_code, 2, "unrelated fields must be preserved");
});

test("replacement shape mirrors the tool response", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();
  const verbose = () => Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n");

  const stringResponse = await handlePostToolUse({
    session_id: "shape-string",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: verbose(),
  }, config, store);
  const stringOutput = (stringResponse?.hookSpecificOutput as { updatedToolOutput: unknown }).updatedToolOutput;
  assert.equal(typeof stringOutput, "string");
  assert.match(stringOutput as string, /\[token-saver\] test:/);

  const blocksResponse = await handlePostToolUse({
    session_id: "shape-blocks",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { content: [{ type: "text", text: verbose() }] },
  }, config, store);
  const blockOutput = (blocksResponse?.hookSpecificOutput as { updatedToolOutput: { content: Array<{ type: string; text: string }> } }).updatedToolOutput;
  assert.equal(blockOutput.content.length, 1);
  assert.equal(blockOutput.content[0].type, "text");
  assert.match(blockOutput.content[0].text, /\[token-saver\] test:/);

  const processResponse = await handlePostToolUse({
    session_id: "shape-stdout",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { stdout: verbose(), stderr: "", exit_code: 0 },
  }, config, store);
  const processOutput = (processResponse?.hookSpecificOutput as { updatedToolOutput: { stdout: string; stderr: string } }).updatedToolOutput;
  assert.match(processOutput.stdout, /\[token-saver\] test:/);
  assert.equal(processOutput.stderr, "");
});

test("uncompacted reads and small output are not changed", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();
  const large = "x".repeat(5_000);
  assert.equal(await handlePostToolUse({
    tool_name: "Bash",
    tool_input: { command: "pwd" },
    tool_response: "ok",
  }, config, store), undefined);
  assert.equal(await handlePostToolUse({
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: "ok",
  }, config, store), undefined);
  assert.equal(await handlePostToolUse({
    tool_name: "Read",
    tool_input: { file_path: "a.ts", offset: 10, limit: 20 },
    tool_response: large,
  }, config, store), undefined);
});

test("read compaction is opt-in and not applied with defaults", async (t) => {
  const store = await storeFor(t);
  const large = Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n");
  assert.equal(await handlePostToolUse({
    tool_name: "Read",
    tool_input: { file_path: "a.ts" },
    tool_response: large,
  }, resolveConfig(), store), undefined, "automatic read compaction must be off by default");

  const readEnabled = resolveConfig({ enabledTools: ["shell", "test", "search", "read"] });
  const result = await handlePostToolUse({
    session_id: "read-opt-in",
    tool_name: "Read",
    tool_input: { file_path: "a.ts" },
    tool_response: { content: large },
  }, readEnabled, store);
  assert.match(
    ((result?.hookSpecificOutput as { updatedToolOutput: { content: string } }).updatedToolOutput).content,
    /\[token-saver\] read:/,
  );
});

test("tool output extraction supports text arrays and process results", () => {
  assert.equal(extractToolOutput({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }), "one\ntwo");
  assert.equal(extractToolOutput({ stdout: "out", stderr: "err" }), "out\nerr");
});
