import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path: string) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("Qoder plugin manifest identifies token-saver", async () => {
  const manifest = await json("../.qoder-plugin/plugin.json");
  assert.equal(manifest.name, "token-saver");
  assert.equal(manifest.license, "MIT");
  assert.ok(manifest.description.length > 0);
});

test("Qoder hooks replace tool output for command and read tools", async () => {
  const hooks = await json("../hooks/hooks.json");
  const postToolUse = hooks.hooks.PostToolUse[0];
  assert.match(postToolUse.matcher, /Bash/);
  assert.match(postToolUse.matcher, /Read/);
  assert.match(postToolUse.matcher, /Grep/);
  assert.match(postToolUse.matcher, /run_in_terminal/);
  assert.match(postToolUse.hooks[0].command, /dist\/post-tool-use\.js/);
  assert.match(postToolUse.hooks[0].command, /\$\{QODER_PLUGIN_ROOT\}/);
  assert.ok(hooks.hooks.PreCompact);
  assert.match(hooks.hooks.PreCompact[0].hooks[0].command, /dist\/pre-compact\.js/);
});

test("Qoder plugin registers the shared stdio MCP server", async () => {
  const mcp = await json("../.mcp.json");
  const server = mcp.mcpServers["token-saver"];
  assert.equal(server.type, "stdio");
  assert.equal(server.command, "node");
  assert.match(server.args[0], /dist\/mcp-server\.js/);
});

test("Qoder skill documents recovery and compact tool selection", async () => {
  const skill = await readFile(new URL("../skills/token-saver/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /output_slice/);
  assert.match(skill, /compact_run/);
  assert.match(skill, /Do not rerun a verbose command/);
});
