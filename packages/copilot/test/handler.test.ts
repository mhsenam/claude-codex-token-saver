import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore, resolveConfig } from "../../core/src/index.js";
import { handleCopilotPostToolUse } from "../src/handler.js";

async function storeFor(t: test.TestContext): Promise<ArtifactStore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-copilot-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new ArtifactStore(resolveConfig(), root);
}

const verbose = () => Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n");

test("Copilot postToolUse returns modifiedResult with compacted text", async (t) => {
  const store = await storeFor(t);
  const result = await handleCopilotPostToolUse({
    sessionId: "copilot-test",
    toolName: "bash",
    toolArgs: { command: "npm test" },
    toolResult: { resultType: "success", textResultForLlm: verbose() },
  }, resolveConfig(), store);
  const modified = result?.modifiedResult as { resultType: string; textResultForLlm: string };
  assert.equal(modified.resultType, "success");
  assert.match(modified.textResultForLlm, /\[token-saver\] test:/);
});

test("small output, missing text, and missing tool name pass through", async (t) => {
  const store = await storeFor(t);
  const config = resolveConfig();
  assert.equal(await handleCopilotPostToolUse({
    toolName: "bash", toolArgs: { command: "pwd" },
    toolResult: { resultType: "success", textResultForLlm: "ok" },
  }, config, store), undefined);
  assert.equal(await handleCopilotPostToolUse({
    toolName: "bash", toolResult: { resultType: "success" },
  }, config, store), undefined);
  assert.equal(await handleCopilotPostToolUse({}, config, store), undefined);
});

test("view is treated as read and stays opt-in", async (t) => {
  const store = await storeFor(t);
  const large = verbose();
  assert.equal(await handleCopilotPostToolUse({
    toolName: "view", toolArgs: { path: "a.ts" },
    toolResult: { resultType: "success", textResultForLlm: large },
  }, resolveConfig(), store), undefined, "view must map to read (opt-in, off by default)");

  const readEnabled = resolveConfig({ enabledTools: ["shell", "test", "search", "read"] });
  const result = await handleCopilotPostToolUse({
    sessionId: "copilot-read", toolName: "view", toolArgs: { path: "a.ts" },
    toolResult: { resultType: "success", textResultForLlm: large },
  }, readEnabled, store);
  const modified = result?.modifiedResult as { textResultForLlm: string };
  assert.match(modified.textResultForLlm, /\[token-saver\] read:/);
});

test("grep maps to the search policy", async (t) => {
  const store = await storeFor(t);
  const content = Array.from({ length: 800 }, (_, index) => `src/file.ts:${index + 1}:match`).join("\n");
  const result = await handleCopilotPostToolUse({
    sessionId: "copilot-grep", toolName: "grep", toolArgs: { pattern: "match" },
    toolResult: { resultType: "success", textResultForLlm: content },
  }, resolveConfig(), store);
  const modified = result?.modifiedResult as { textResultForLlm: string };
  assert.match(modified.textResultForLlm, /\[token-saver\] search:/);
});
