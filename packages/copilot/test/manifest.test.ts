import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path: string) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("Copilot hooks replace tool output for shell, search, and view tools", async () => {
  const hooks = await json("../hooks/hooks.json");
  assert.equal(hooks.version, 1);
  const postToolUse = hooks.hooks.postToolUse[0];
  assert.equal(postToolUse.type, "command");
  assert.equal(postToolUse.matcher, "bash|powershell|grep|glob|view");
  assert.equal(postToolUse.bash, "./post-tool-use.sh");
  assert.equal(postToolUse.powershell, "./post-tool-use.ps1");
  assert.equal(postToolUse.timeoutSec, 5);
});

test("Copilot registers the universal npx MCP server", async () => {
  const mcp = await json("../.mcp.json");
  const server = mcp.mcpServers["token-saver"];
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["-y", "token-saver-mcp"]);
});

test("Copilot bundles a non-empty token-saver skill", async () => {
  const skill = await readFile(new URL("../skills/token-saver/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.trim().length > 0, "bundled skill must not be empty");
});
