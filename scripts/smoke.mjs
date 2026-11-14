import assert from "node:assert/strict";
import { exec, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execAsync = promisify(exec);
const artifacts = await mkdtemp(path.join(os.tmpdir(), "token-saver-smoke-"));
process.env.TOKEN_SAVER_DATA_DIR = artifacts;
process.env.TOKEN_SAVER_REWRITE = "1";
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
    session_id: "built-smoke-qoder",
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

  const copilotInput = {
    sessionId: "built-smoke-copilot",
    toolName: "bash",
    toolArgs: { command: "npm test" },
    toolResult: {
      resultType: "success",
      textResultForLlm: Array.from({ length: 400 }, (_, index) => `log ${index}`).join("\n"),
    },
  };
  const copilotHook = spawnSync(process.execPath, ["packages/copilot/dist/post-tool-use.js"], {
    input: JSON.stringify(copilotInput),
    encoding: "utf8",
    env: { ...process.env, TOKEN_SAVER_DATA_DIR: artifacts },
  });
  assert.equal(copilotHook.status, 0, copilotHook.stderr);
  const copilotOutput = JSON.parse(copilotHook.stdout);
  assert.equal(copilotOutput.modifiedResult.resultType, "success");
  assert.match(copilotOutput.modifiedResult.textResultForLlm, /\[token-saver\] test:/);

  const pluginModule = await import(
    pathToFileURL(path.resolve("packages/opencode/dist/plugin.js"))
  );
  const plugin = pluginModule.default ?? pluginModule.TokenSaverPlugin;
  const pluginHooks = await plugin({});

  const verboseBash = () => ({
    title: "npm test",
    output: Array.from({ length: 400 }, (_, index) => `log ${index}`).join("\n"),
    metadata: {},
  });
  const firstOpencode = verboseBash();
  await pluginHooks["tool.execute.after"](
    { tool: "bash", sessionID: "smoke-opencode", callID: "c1", args: { command: "npm test" } },
    firstOpencode,
  );
  assert.match(firstOpencode.output, /\[token-saver\] test:/);
  const artifactId = /Full output: ([A-Za-z0-9_-]+\.[0-9a-f-]+);/.exec(firstOpencode.output)?.[1];
  assert.ok(artifactId, "expected artifact ID in compacted opencode output");
  const slice = await pluginHooks.tool.output_slice.execute({ artifactId, startLine: 2, maxLines: 3 });
  assert.match(slice, /lines 2-4 of 400/);

  const sessionDir = path.join(artifacts, "smoke-opencode");
  const artifactsBefore = (await readdir(sessionDir)).filter((name) => name.endsWith(".log")).length;
  const duplicateOpencode = verboseBash();
  await pluginHooks["tool.execute.after"](
    { tool: "bash", sessionID: "smoke-opencode", callID: "c2", args: { command: "npm test" } },
    duplicateOpencode,
  );
  assert.match(duplicateOpencode.output, /\[token-saver\] duplicate:/);
  assert.match(duplicateOpencode.output, new RegExp(artifactId.replaceAll(".", "\\.")));
  assert.ok(duplicateOpencode.output.length < firstOpencode.output.length, "duplicate stub should be smaller than the compacted original");
  const artifactsAfter = (await readdir(sessionDir)).filter((name) => name.endsWith(".log")).length;
  assert.equal(artifactsAfter, artifactsBefore, "duplicate must not write a second artifact");

  const beforeOutput = { args: { command: "npm test" } };
  await pluginHooks["tool.execute.before"](
    { tool: "bash", sessionID: "smoke-rewrite", callID: "b1" },
    beforeOutput,
  );
  const rewritten = beforeOutput.args.command;
  assert.match(rewritten, /npm test > "\$__ts_log" 2>&1/);
  assert.match(rewritten, /full output: smoke-rewrite\.[0-9a-f-]{36}/);

  const project = await mkdtemp(path.join(os.tmpdir(), "token-saver-rewrite-"));
  try {
    await writeFile(path.join(project, "package.json"), JSON.stringify({
      name: "token-saver-rewrite-fixture",
      version: "1.0.0",
      scripts: { test: "node -e \"for(let i=0;i<300;i++) console.log('line '+i)\"" },
    }));
    const run = await execAsync(rewritten, { cwd: project, shell: "bash", encoding: "utf8" });
    assert.match(run.stdout, /\[token-saver\] full output: (smoke-rewrite\.[0-9a-f-]{36}) \(exit 0\)/);
    const rewrittenArtifactId = /full output: (smoke-rewrite\.[0-9a-f-]{36})/.exec(run.stdout)?.[1];
    const recovered = await pluginHooks.tool.output_slice.execute({
      artifactId: rewrittenArtifactId,
      startLine: 200,
      maxLines: 300,
    });
    assert.match(recovered, /lines 200-\d+ of 30\d/);
    assert.match(recovered, /line 299/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }

  const stats = await pluginHooks.tool.stats.execute();
  assert.match(stats, /compactions: \d+/);
  assert.match(stats, /commands rewritten: 1/);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["packages/codex/dist/mcp-server.js"],
    env: { ...process.env },
  });
  const client = new Client({ name: "token-saver-smoke", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["compact_read", "compact_run", "compact_search", "output_slice", "stats"],
  );
  const result = await client.callTool({
    name: "compact_run",
    arguments: { command: "node -e \"for(let i=0;i<300;i++) console.log(i)\"" },
  });
  assert.match(result.content[0].text, /\[token-saver\] shell:/);
  assert.match(result.content[0].text, /\[exit code: 0\]/);
  const mcpStats = await client.callTool({ name: "stats", arguments: {} });
  assert.match(mcpStats.content[0].text, /\[token-saver\] session statistics/);
  assert.match(mcpStats.content[0].text, /compactions: \d+/);
  await client.close();

  const binTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["packages/mcp-server/dist/mcp-server.js"],
    env: { ...process.env },
  });
  const binClient = new Client({ name: "token-saver-bin-smoke", version: "1.0.0" });
  await binClient.connect(binTransport);
  const binTools = await binClient.listTools();
  assert.deepEqual(
    binTools.tools.map((tool) => tool.name).sort(),
    ["compact_read", "compact_run", "compact_search", "output_slice", "stats"],
  );
  await binClient.close();
  console.log("Built Claude hook, Qoder hook, opencode plugin, Codex MCP server, and token-saver-compactor bin passed smoke tests.");
} finally {
  await rm(artifacts, { recursive: true, force: true });
}
