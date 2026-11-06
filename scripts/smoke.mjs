import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const artifacts = await mkdtemp(path.join(os.tmpdir(), "token-saver-smoke-"));
try {
  const input = {
    session_id: "built-smoke",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: Array.from({ length: 400 }, (_, index) => `log ${index}`).join("\n"),
  };
  const hook = spawnSync(process.execPath, ["packages/claude/dist/post-tool-use.js"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, TOKEN_SAVER_DATA_DIR: artifacts },
  });
  assert.equal(hook.status, 0, hook.stderr);
  const hookOutput = JSON.parse(hook.stdout);
  assert.match(hookOutput.hookSpecificOutput.updatedToolOutput, /\[token-saver\] test:/);

  const qoderInput = {
    session_id: "built-smoke",
    tool_use_id: "toolu_01SMOKE",
    tool_name: "run_in_terminal",
    tool_input: { command: "npm test" },
    tool_response: Array.from({ length: 400 }, (_, index) => `log ${index}`).join("\n"),
  };
  const qoderHook = spawnSync(process.execPath, ["packages/qoder/dist/post-tool-use.js"], {
    input: JSON.stringify(qoderInput),
    encoding: "utf8",
    env: { ...process.env, TOKEN_SAVER_DATA_DIR: artifacts },
  });
  assert.equal(qoderHook.status, 0, qoderHook.stderr);
  const qoderOutput = JSON.parse(qoderHook.stdout);
  assert.match(qoderOutput.hookSpecificOutput.updatedToolOutput, /\[token-saver\] test:/);

  const pluginModule = await import(
    pathToFileURL(path.resolve("packages/opencode/dist/plugin.js"))
  );
  const plugin = pluginModule.default ?? pluginModule.TokenSaverPlugin;
  const pluginHooks = await plugin({});
  const opencodeOutput = {
    title: "npm test",
    output: Array.from({ length: 400 }, (_, index) => `log ${index}`).join("\n"),
    metadata: {},
  };
  await pluginHooks["tool.execute.after"](
    { tool: "bash", sessionID: "smoke-opencode", callID: "c1", args: { command: "npm test" } },
    opencodeOutput,
  );
  assert.match(opencodeOutput.output, /\[token-saver\] test:/);
  const artifactId = /Full output: ([A-Za-z0-9_-]+\.[0-9a-f-]+);/.exec(opencodeOutput.output)?.[1];
  assert.ok(artifactId, "expected artifact ID in compacted opencode output");
  const slice = await pluginHooks.tool.output_slice.execute({ artifactId, startLine: 2, maxLines: 3 });
  assert.match(slice, /lines 2-4 of 400/);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["packages/codex/dist/mcp-server.js"],
    env: { ...process.env, TOKEN_SAVER_DATA_DIR: artifacts },
  });
  const client = new Client({ name: "token-saver-smoke", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["compact_read", "compact_run", "compact_search", "output_slice"],
  );
  const result = await client.callTool({
    name: "compact_run",
    arguments: { command: "node -e \"for(let i=0;i<300;i++) console.log(i)\"" },
  });
  assert.match(result.content[0].text, /\[token-saver\] shell:/);
  assert.match(result.content[0].text, /\[exit code: 0\]/);
  await client.close();
  console.log("Built Claude hook, Qoder hook, opencode plugin, and Codex MCP server passed smoke tests.");
} finally {
  await rm(artifacts, { recursive: true, force: true });
}
