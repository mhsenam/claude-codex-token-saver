import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path: string) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("Codex package registers stdio MCP and only documented hooks", async () => {
  const plugin = await json("../plugin.json");
  const mcp = await json("../mcp.json");
  const hooks = await json("../hooks/hooks.json");

  assert.equal(plugin.name, "token-saver");
  assert.equal(mcp.mcpServers["token-saver"].type, "stdio");
  assert.ok(hooks.hooks.PreCompact);
  assert.equal(hooks.hooks.PostToolUse, undefined);
});

test("Codex skill selects compact tools without banning exact built-in reads", async () => {
  const skill = await readFile(new URL("../skills/token-saver/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /compact_run/);
  assert.match(skill, /output_slice/);
  assert.match(skill, /built-in tools for small outputs, exact edits, and precise file ranges/);
});
