import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preCompactInstructions } from "../../core/src/index.js";
import { TokenSaverPlugin } from "../src/plugin.js";

type PluginInput = Parameters<typeof TokenSaverPlugin>[0];
type HookInput = { tool: string; sessionID: string; callID: string; args: unknown };
type HookOutput = { title: string; output: string; metadata: unknown };

async function pluginFor(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-opencode-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  process.env.TOKEN_SAVER_DATA_DIR = root;
  process.env.TOKEN_SAVER_REWRITE = "1";
  t.after(() => delete process.env.TOKEN_SAVER_REWRITE);
  const hooks = await TokenSaverPlugin({} as PluginInput);
  return hooks;
}

test("verbose bash output is replaced with a compact artifact header", async (t) => {
  const hooks = await pluginFor(t);
  const output: HookOutput = {
    title: "npm test",
    output: Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n"),
    metadata: {},
  };
  await hooks["tool.execute.after"]!(
    { tool: "bash", sessionID: "opencode-test", callID: "c1", args: { command: "npm test" } },
    output,
  );
  assert.match(output.output, /\[token-saver\] test:/);
  assert.match(output.output, /omitted/);
});

test("read calls with explicit ranges pass through unchanged", async (t) => {
  const hooks = await pluginFor(t);
  const large = Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n");
  const output: HookOutput = { title: "a.ts", output: large, metadata: {} };
  await hooks["tool.execute.after"]!(
    { tool: "read", sessionID: "opencode-test", callID: "c2", args: { filePath: "a.ts", offset: 10, limit: 20 } },
    output,
  );
  assert.equal(output.output, large);
});

test("grep output is compacted with the search policy", async (t) => {
  const hooks = await pluginFor(t);
  const output: HookOutput = {
    title: "grep",
    output: Array.from({ length: 400 }, (_, index) => `src/file-${index % 7}.ts:${index + 1}:match ${index}`).join("\n"),
    metadata: {},
  };
  await hooks["tool.execute.after"]!(
    { tool: "grep", sessionID: "opencode-test", callID: "c3", args: { pattern: "match" } },
    output,
  );
  assert.match(output.output, /\[token-saver\] search:/);
  assert.match(output.output, /matches across/);
});

test("small output and other tools pass through unchanged", async (t) => {
  const hooks = await pluginFor(t);
  const small: HookOutput = { title: "pwd", output: "/repo", metadata: {} };
  await hooks["tool.execute.after"]!(
    { tool: "bash", sessionID: "opencode-test", callID: "c4", args: { command: "pwd" } },
    small,
  );
  assert.equal(small.output, "/repo");
  const glob: HookOutput = { title: "glob", output: "x".repeat(40_000), metadata: {} };
  await hooks["tool.execute.after"]!(
    { tool: "glob", sessionID: "opencode-test", callID: "c5", args: { pattern: "**/*" } },
    glob,
  );
  assert.equal(glob.output, "x".repeat(40_000));
});

test("output_slice retrieves stored ranges and reports invalid IDs", async (t) => {
  const hooks = await pluginFor(t);
  const executeSlice = hooks.tool!.output_slice.execute as (
    args: { artifactId: string; startLine?: number; maxLines?: number },
  ) => Promise<string>;
  const output: HookOutput = {
    title: "npm test",
    output: Array.from({ length: 500 }, (_, index) => `log ${index}`).join("\n"),
    metadata: {},
  };
  await hooks["tool.execute.after"]!(
    { tool: "bash", sessionID: "opencode-test", callID: "c6", args: { command: "npm test" } },
    output,
  );
  const artifactId = /\[token-saver\] test: .*Full output: ([A-Za-z0-9_-]+\.[0-9a-f-]+);/.exec(output.output)?.[1];
  assert.ok(artifactId, "expected artifact ID in compacted header");

  const slice = await executeSlice({ artifactId: artifactId!, startLine: 450, maxLines: 5 });
  assert.match(slice, /lines 450-454 of 500/);
  assert.match(slice, /^log 449$/m);

  const invalid = await executeSlice({ artifactId: "not-an-artifact" });
  assert.match(invalid, /^token-saver error:/);
});

test("session compacting hook appends preservation instructions", async (t) => {
  const hooks = await pluginFor(t);
  const output = { context: [] as string[] };
  await hooks["experimental.session.compacting"]!({ sessionID: "opencode-test" }, output);
  assert.ok(output.context.includes(preCompactInstructions));
});

test("before hook rewrites whitelisted verbose commands into artifact-redirecting ones", async (t) => {
  const hooks = await pluginFor(t);
  const before = hooks["tool.execute.before"]!;
  const output = { args: { command: "npm test" } };
  await before({ tool: "bash", sessionID: "rewrite-test", callID: "b1" }, output);
  const rewritten = output.args.command as string;
  assert.match(rewritten, /npm test > "\$__ts_log" 2>&1/);
  assert.match(rewritten, /tail -n \d+/);
  assert.match(rewritten, /\[token-saver\] full output: rewrite-test\.[0-9a-f-]{36}/);
  assert.match(rewritten, /exit \$__ts_code/);
});

test("before hook leaves non-verbose or shell-composite commands untouched", async (t) => {
  const hooks = await pluginFor(t);
  const before = hooks["tool.execute.before"]!;
  const piped = { args: { command: "npm test | head -50" } };
  await before({ tool: "bash", sessionID: "s", callID: "b2" }, piped);
  assert.equal(piped.args.command, "npm test | head -50");

  const quiet = { args: { command: "pwd" } };
  await before({ tool: "bash", sessionID: "s", callID: "b3" }, quiet);
  assert.equal(quiet.args.command, "pwd");

  const other = { args: { pattern: "**/*" } };
  await before({ tool: "glob", sessionID: "s", callID: "b4" }, other);
  assert.equal(other.args.pattern, "**/*");
});

test("stats tool summarizes recorded activity", async (t) => {
  const hooks = await pluginFor(t);
  const output: HookOutput = {
    title: "npm test",
    output: Array.from({ length: 300 }, (_, index) => `log ${index}`).join("\n"),
    metadata: {},
  };
  await hooks["tool.execute.after"]!(
    { tool: "bash", sessionID: "stats-test", callID: "c7", args: { command: "npm test" } },
    output,
  );
  const summary = await (hooks.tool!.stats.execute as () => Promise<string>)();
  assert.match(summary, /compactions: 1/);
  assert.match(summary, /read:\s|test:\s|shell:\s/);
});
