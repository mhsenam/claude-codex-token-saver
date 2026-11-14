# Multi-harness Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TokenSaver installable in any MCP-capable harness via an npx package + single-sourced skill, and add a native GitHub Copilot CLI automatic-compaction adapter.

**Architecture:** Extend in place. Publish the existing self-contained MCP bundle as `token-saver-mcp` on npmjs.com; add `packages/copilot/` mirroring `packages/claude/` (shared core hook-handler, translated to Copilot's payload/response shape); single-source one universal skill and emit host wrappers at package time. No changes to the compaction core, artifact store, dedup, or stats.

**Tech Stack:** TypeScript (NodeNext, strict), Node.js ≥ 22, esbuild bundles, `node:test` via tsx, MCP SDK, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-multi-harness-expansion-design.md`

## Global Constraints

- Node.js ≥ 22 (`engines.node: ">=22"`).
- Deterministic and local-first: no model calls, no telemetry, no network at runtime.
- Fail-open: any hook/compaction error passes the original output through unchanged.
- Automatic read compaction stays OFF by default (opt-in via `TOKEN_SAVER_TOOLS`).
- Universal npm package name: `token-saver-mcp`, unscoped, published to npmjs.com.
- Version `0.5.0` synced across all packages and plugin manifests.
- Universal skill body content MUST be byte-identical across every host wrapper.
- `packages/*/dist` bundles are tracked in git (marketplace installs need no build).
- `TOKEN_SAVER_DEBUG=1` writes hook diagnostics to stderr.
- Copilot tool-name alias: `view` → `Read` (so read stays opt-in; `detectToolKind` substring-matches "read").

## File Structure

New files:
- `packages/mcp-server/skills/token-saver/SKILL.md` — canonical universal skill (Codex-style, on-demand).
- `scripts/skill-variants.mjs` — pure variant builder + writer (build-time).
- `scripts/skill-variants.d.mts` — types for the emitter so `tsc` stays green.
- `packages/mcp-server/test/skill-variants.test.ts` — body-identity test.
- `packages/copilot/package.json` — workspace package.
- `packages/copilot/src/handler.ts` — payload/response translation over core.
- `packages/copilot/src/post-tool-use.ts` — stdin/stdout entry, fail-open.
- `packages/copilot/test/handler.test.ts` — handler unit tests.
- `packages/copilot/hooks/hooks.json` — postToolUse wiring (verified live in Task 6).
- `packages/copilot/hooks/post-tool-use.sh`, `post-tool-use.ps1` — command wrappers.
- `packages/copilot/skills/token-saver/SKILL.md` — automatic-compaction skill variant.
- `packages/copilot/.mcp.json` — MCP config snippet.
- `docs/hosts.md` — per-host install + capability notes.

Modified files:
- `packages/mcp-server/package.json` — rename, un-private, bin/files/engines.
- `scripts/build.mjs` — copilot + mcp-server dist bundles, shebang banner.
- `scripts/smoke.mjs` — copilot hook fixture + mcp-server bin handshake.
- `scripts/package.mjs` — copilot release dir + skill-variant emission.
- `package.json` — add copilot test glob; version bump.
- `.github/workflows/npm-package.yml` — npmjs publish job.
- `README.md` — host table + quick start.
- `packages/mcp-server/src/server.ts` — version string sync.
- All `packages/*/package.json` + plugin manifests — version bump.

---

### Task 1: Universal skill + variant emitter

**Files:**
- Create: `packages/mcp-server/skills/token-saver/SKILL.md`
- Create: `scripts/skill-variants.mjs`
- Create: `scripts/skill-variants.d.mts`
- Test: `packages/mcp-server/test/skill-variants.test.ts`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces: `buildVariants(canonical: string): SkillVariant[]`, `bodyOf(raw: string): string`, `splitFrontmatter(raw: string): { frontmatter: string; body: string }`, `emitSkillVariants(root?: string): Promise<void>` where `SkillVariant = { path: string; content: string }`. Task 2 ships the canonical skill; Task 5 calls `emitSkillVariants()`.

- [ ] **Step 1: Write the canonical universal skill**

Create `packages/mcp-server/skills/token-saver/SKILL.md` (Codex-style, host-neutral; this exact body is the single source of truth):

```markdown
---
name: token-saver
description: Run verbose operations through token-saver compact tools and recover compacted output without rerunning. Use before running test suites, builds, installs, migrations, broad searches, or large file reads expected to exceed about 100 lines of output; also when a result contains a token-saver artifact ID, or when asked about token savings.
---

# Token Saver

For operations expected to produce more than about 100 lines, use the token-saver MCP tools:

- `compact_run` for verbose builds, tests, installs, and other shell commands. Not for interactive commands or output the user must read in full.
- `compact_search` for broad repository searches; scope `paths` or `glob` when possible.
- `compact_read` for large files when an exact range is not required. It always compacts when called without `startLine`, even for short files; use the built-in read for files under about 100 lines.

An explicit `startLine` returns an exact uncompacted range. Never edit based on a compacted preview; fetch the exact region first.

When output contains a token-saver artifact ID, call `output_slice` with `maxLines` 40-50; never omit it (the default returns 200 lines). Continue by advancing `startLine`; do not widen the window. Do not rerun a verbose command solely to recover stored output. A `[token-saver] duplicate:` result repeats an earlier output; trust its preview and slice the referenced artifactId if a specific line matters. After a fix, rerun the narrowest failing command.

To report savings, call `stats`; figures are estimates.
```

- [ ] **Step 2: Write the failing test**

Create `packages/mcp-server/test/skill-variants.test.ts`:

```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bodyOf, buildVariants } from "../../../scripts/skill-variants.mjs";

test("skill variants preserve body content identity", async () => {
  const canonical = await readFile("packages/mcp-server/skills/token-saver/SKILL.md", "utf8");
  const canonicalBody = bodyOf(canonical);
  const variants = buildVariants(canonical);
  assert.ok(variants.length >= 6, "expected at least six host wrappers");
  for (const variant of variants) {
    assert.equal(bodyOf(variant.content), canonicalBody, `body drifted in ${variant.path}`);
  }
  const paths = variants.map((v) => v.path);
  for (const required of ["cursor/token-saver.mdc", "cline/token-saver.md", "goose/.goosehints", "zed/token-saver.rules", "agents/AGENTS.md", "antigravity/token-saver/SKILL.md"]) {
    assert.ok(paths.includes(required), `missing wrapper ${required}`);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test packages/mcp-server/test/skill-variants.test.ts`
Expected: FAIL — cannot resolve `../../../scripts/skill-variants.mjs`.

- [ ] **Step 4: Write the emitter**

Create `scripts/skill-variants.mjs`:

```javascript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function splitFrontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) return { frontmatter: "", body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

export function bodyOf(raw) {
  return splitFrontmatter(raw).body;
}

export function buildVariants(canonical) {
  const { frontmatter, body } = splitFrontmatter(canonical);
  const description = /description:\s*(.+)/.exec(frontmatter)?.[1]?.trim() ?? "";
  return [
    { path: "antigravity/token-saver/SKILL.md", content: canonical },
    { path: "cursor/token-saver.mdc", content: `---\ndescription: ${description}\nglobs:\nalwaysApply: false\n---\n${body}` },
    { path: "cline/token-saver.md", content: body },
    { path: "goose/.goosehints", content: body },
    { path: "zed/token-saver.rules", content: body },
    { path: "agents/AGENTS.md", content: body },
  ];
}

export async function emitSkillVariants(root = "release/skills") {
  const canonical = await readFile("packages/mcp-server/skills/token-saver/SKILL.md", "utf8");
  for (const variant of buildVariants(canonical)) {
    const dest = path.join(root, variant.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, variant.content);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await emitSkillVariants();
}
```

Create `scripts/skill-variants.d.mts` (keeps `tsc` green on the `.mjs` import):

```typescript
export interface SkillVariant { path: string; content: string; }
export function splitFrontmatter(raw: string): { frontmatter: string; body: string };
export function bodyOf(raw: string): string;
export function buildVariants(canonical: string): SkillVariant[];
export function emitSkillVariants(root?: string): Promise<void>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test packages/mcp-server/test/skill-variants.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `.d.mts` resolves the `.mjs` import).

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/skills/token-saver/SKILL.md scripts/skill-variants.mjs scripts/skill-variants.d.mts packages/mcp-server/test/skill-variants.test.ts
git commit -m "feat: single-source universal skill with host variant emitter"
```

---

### Task 2: Publishable MCP package (npx)

**Files:**
- Modify: `packages/mcp-server/package.json`
- Modify: `scripts/build.mjs`
- Modify: `scripts/smoke.mjs`
- Modify: `package-lock.json` (regenerated)

**Interfaces:**
- Consumes: canonical skill from Task 1 (shipped via `files`); existing `packages/mcp-server/src/server.ts` entry.
- Produces: `packages/mcp-server/dist/mcp-server.js` (self-contained, shebang) and bin `token-saver-mcp`. Task 5 publishes it; `docs/hosts.md` (Task 4) references `npx -y token-saver-mcp`.

- [ ] **Step 1: Add the bin-handshake smoke assertion (failing)**

In `scripts/smoke.mjs`, immediately before the final `console.log(...)` line, add:

```javascript
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
```

Also update the final `console.log` to mention the MCP bin:

```javascript
  console.log("Built Claude hook, Qoder hook, opencode plugin, Codex MCP server, and token-saver-mcp bin passed smoke tests.");
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `npm run build && npm run smoke`
Expected: FAIL — `packages/mcp-server/dist/mcp-server.js` does not exist yet.

- [ ] **Step 3: Make the package publishable**

Replace `packages/mcp-server/package.json` with:

```json
{
  "name": "token-saver-mcp",
  "version": "0.4.0",
  "description": "Deterministic, recoverable compaction for verbose coding-tool output. Universal MCP server for any agentic harness.",
  "license": "MIT",
  "type": "module",
  "bin": { "token-saver-mcp": "dist/mcp-server.js" },
  "files": ["dist", "skills"],
  "engines": { "node": ">=22" },
  "repository": { "type": "git", "url": "git+https://github.com/mhsenam/claude-codex-token-saver.git" },
  "keywords": ["mcp", "token-optimization", "context-optimization", "coding-agent"]
}
```

Notes: `private` removed; runtime deps dropped because the esbuild bundle inlines core + MCP SDK + zod (they remain in the root `package.json` for the workspace build). Nothing imports this package by name, so the rename is safe.

- [ ] **Step 4: Add the mcp-server dist bundle with a shebang**

In `scripts/build.mjs`, change the `bundle` helper to accept an optional banner:

```javascript
const bundle = (entry, outfile, banner) =>
  build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "eof",
    ...(banner ? { banner: { js: banner } } : {}),
  });
```

Add `"mcp-server"` to the `hosts` array (used for `rm`/`mkdir` of `dist`):

```javascript
const hosts = ["claude", "codex", "opencode", "qoder", "mcp-server"];
```

Add this entry to the `Promise.all([...])` bundle list:

```javascript
  bundle("packages/mcp-server/src/server.ts", "packages/mcp-server/dist/mcp-server.js", "#!/usr/bin/env node"),
```

- [ ] **Step 5: Regenerate the lockfile**

Run: `npm install`
Expected: `package-lock.json` updates the workspace entry from `@token-saver/mcp-server` to `token-saver-mcp`.

- [ ] **Step 6: Build and run smoke to verify it passes**

Run: `npm run build && npm run smoke`
Expected: PASS, including the new bin handshake.

- [ ] **Step 7: Verify the publishable tarball contents**

Run: `npm pack --dry-run --workspace=token-saver-mcp`
Expected: file list includes `dist/mcp-server.js` and `skills/token-saver/SKILL.md`; no `src/` or `test/`.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-server/package.json scripts/build.mjs scripts/smoke.mjs package-lock.json packages/mcp-server/dist
git commit -m "feat: publish token-saver-mcp as a self-contained npx MCP bin"
```

---

### Task 3: Copilot CLI native adapter

**Files:**
- Create: `packages/copilot/package.json`
- Create: `packages/copilot/src/handler.ts`
- Create: `packages/copilot/src/post-tool-use.ts`
- Create: `packages/copilot/test/handler.test.ts`
- Create: `packages/copilot/hooks/hooks.json`
- Create: `packages/copilot/hooks/post-tool-use.sh`
- Create: `packages/copilot/hooks/post-tool-use.ps1`
- Create: `packages/copilot/skills/token-saver/SKILL.md`
- Create: `packages/copilot/.mcp.json`
- Modify: `scripts/build.mjs`, `scripts/smoke.mjs`, `package.json` (test glob)

**Interfaces:**
- Consumes: `handlePostToolUse(payload, config, store, defaultSession)`, `configFromEnv`, `resolveConfig`, `ArtifactStore`, types `CompactionConfig` from `packages/core/src/index.js`. Core returns `{ hookSpecificOutput: { hookEventName, updatedToolOutput } }` or `undefined`.
- Produces: `handleCopilotPostToolUse(payload: CopilotPostToolUse, config?, store?): Promise<Record<string, unknown> | undefined>` returning `{ modifiedResult: { resultType: "success", textResultForLlm } }` or `undefined`. `CopilotPostToolUse = { sessionId?: string; toolName?: string; toolArgs?: unknown; toolResult?: { resultType?: string; textResultForLlm?: string } }`.

- [ ] **Step 1: Write the failing handler tests**

Create `packages/copilot/test/handler.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test packages/copilot/test/handler.test.ts`
Expected: FAIL — cannot resolve `../src/handler.js`.

- [ ] **Step 3: Write the handler**

Create `packages/copilot/src/handler.ts`:

```typescript
import { configFromEnv, handlePostToolUse } from "../../core/src/index.js";
import type { ArtifactStore, CompactionConfig } from "../../core/src/index.js";

export interface CopilotPostToolUse {
  sessionId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: { resultType?: string; textResultForLlm?: string };
}

const TOOL_NAME_ALIASES: Record<string, string> = { view: "Read" };

export async function handleCopilotPostToolUse(
  payload: CopilotPostToolUse,
  config: CompactionConfig = configFromEnv(),
  store?: ArtifactStore,
): Promise<Record<string, unknown> | undefined> {
  const text = payload.toolResult?.textResultForLlm;
  if (!payload.toolName || typeof text !== "string") return undefined;
  const result = await handlePostToolUse(
    {
      session_id: payload.sessionId,
      tool_name: TOOL_NAME_ALIASES[payload.toolName] ?? payload.toolName,
      tool_input: payload.toolArgs,
      tool_response: text,
    },
    config,
    store,
    "copilot",
  );
  if (!result) return undefined;
  const updated = (result.hookSpecificOutput as { updatedToolOutput?: unknown }).updatedToolOutput;
  if (typeof updated !== "string") return undefined;
  return { modifiedResult: { resultType: "success", textResultForLlm: updated } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test packages/copilot/test/handler.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 5: Write the stdin/stdout entry**

Create `packages/copilot/src/post-tool-use.ts`:

```typescript
import { handleCopilotPostToolUse } from "./handler.js";

try {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const output = await handleCopilotPostToolUse(JSON.parse(input));
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  if (process.env.TOKEN_SAVER_DEBUG === "1") {
    process.stderr.write(`token-saver: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
```

- [ ] **Step 6: Add package, hooks, wrappers, skill, MCP snippet**

Create `packages/copilot/package.json`:

```json
{
  "name": "@token-saver/copilot",
  "version": "0.4.0",
  "private": true,
  "license": "MIT",
  "type": "module"
}
```

Create `packages/copilot/hooks/post-tool-use.sh`:

```bash
#!/usr/bin/env bash
exec node "$(dirname "$0")/../dist/post-tool-use.js"
```

Create `packages/copilot/hooks/post-tool-use.ps1`:

```powershell
node (Join-Path $PSScriptRoot "..\dist\post-tool-use.js")
```

Create `packages/copilot/hooks/hooks.json` (documented Copilot shape; exact matcher/path wiring confirmed live in Task 6):

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "type": "command",
        "matcher": "bash|powershell|grep|glob|view",
        "bash": "./post-tool-use.sh",
        "powershell": "./post-tool-use.ps1",
        "timeoutSec": 5
      }
    ]
  }
}
```

Create `packages/copilot/.mcp.json`:

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "npx",
      "args": ["-y", "token-saver-mcp"]
    }
  }
}
```

Create `packages/copilot/skills/token-saver/SKILL.md` (automatic-compaction variant, adapted from Claude's; Copilot's read tool is `view`):

```markdown
---
name: token-saver
description: Retrieve exact lines from token-saver compacted output instead of rerunning commands, and read large files in bounded windows. Use when a result shows a [token-saver] marker or artifact ID, when about to rerun a command just to see earlier output, when reading a large file, or when asked about token savings.
---

# Token Saver

Results marked `[token-saver]` arrive already compacted; the header names the artifact ID.

- Call `output_slice` with `maxLines` 40-50 and never omit it (the default returns 200 lines). Continue by advancing `startLine` to the end of the returned range; do not widen the window. Never retrieve more of an artifact than you will use.
- Do not rerun a verbose command solely to recover output already stored in an artifact. A `[token-saver] duplicate:` result repeats an earlier output; trust its preview, and slice the referenced artifactId if a specific line matters.
- Do not read large files end-to-end. Use `view` with a bounded range or `compact_read` with `startLine` in 100-200-line windows; fetch the next window only if needed. Never edit based on a compacted preview; fetch the exact region you will modify first.
- After a fix, rerun the narrowest failing command, not the whole suite. To report savings, call `stats` and present figures as estimates.
```

- [ ] **Step 7: Wire build, test glob, and smoke**

In `scripts/build.mjs`, add `"copilot"` to the `hosts` array, add this bundle to the `Promise.all([...])` list:

```javascript
  bundle("packages/copilot/src/post-tool-use.ts", "packages/copilot/dist/post-tool-use.js"),
```

and add this copy after the existing `cp` calls:

```javascript
await cp("packages/claude/dist/mcp-server.js", "packages/copilot/dist/mcp-server.js");
```

In root `package.json`, append `packages/copilot/test/*.test.ts` to the `test` script glob.

In `scripts/smoke.mjs`, after the Qoder hook block, add:

```javascript
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
```

- [ ] **Step 8: Build, typecheck, test, smoke**

Run: `npm run build && npm run typecheck && npm test && npm run smoke`
Expected: all PASS, including the Copilot handler tests and smoke fixture.

- [ ] **Step 9: Commit**

```bash
git add packages/copilot scripts/build.mjs scripts/smoke.mjs package.json
git commit -m "feat: add Copilot CLI native compaction adapter"
```

---

### Task 4: Documentation

**Files:**
- Create: `docs/hosts.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npx -y token-saver-mcp` (Task 2), Copilot adapter (Task 3), skill wrappers (Task 1).
- Produces: user-facing install instructions; no code depends on this.

- [ ] **Step 1: Write `docs/hosts.md`**

Create `docs/hosts.md` with: an intro stating long-tail hosts get on-demand compaction only (no automatic hooks, no history eviction); a universal install section (`npx -y token-saver-mcp` MCP config + place the matching skill wrapper from `release/skills/`); a per-host table with MCP config file location and skill placement for Cursor (`.cursor/mcp.json`, `.cursor/rules/token-saver.mdc`), Cline (`cline_mcp_settings.json`, `.clinerules/token-saver.md`), Zoo Code (`.roo/mcp.json`, `.roo/rules/`), Goose (MCP config, `.goosehints`), Windsurf/Devin (`.devin/mcp_config.json`, `.devin/rules/` or AGENTS.md), Zed (`context_servers` in settings.json, `.rules`), Factory (`mcp.json`, AGENTS.md), Antigravity (`mcp_config.json`, `.agents/skills/token-saver/`); a Copilot CLI section (native automatic compaction via `packages/copilot/hooks/hooks.json` + `/mcp add`, manual setup steps); and a "Platform notes" section recording the verified Gemini CLI sunset (June 18, 2026 → Antigravity) and Roo Code shutdown (May 2026 → Zoo Code). Use the exact MCP JSON snippet:

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "token-saver-mcp"] }
  }
}
```

Note Node ≥ 22, a pinned-version fallback (`npx -y token-saver-mcp@0.5.0`), and a local-path fallback for offline use. State that Aider is not supported (no MCP/hooks).

- [ ] **Step 2: Update README**

In `README.md`: extend the "What it does" host table with a Copilot CLI row (automatic via `postToolUse` hook; MCP tools) and an "Other MCP hosts" row (on-demand via `npx -y token-saver-mcp` + skill). Add a Quick start subsection "Other MCP hosts (Cursor, Cline, Goose, Zed, …)" pointing to `docs/hosts.md` with the npx snippet. Add a Copilot CLI quick start subsection. Update the header tagline/badges line to mention Copilot CLI and the universal MCP install. Keep the existing four hosts' sections unchanged.

- [ ] **Step 3: Verify links and consistency**

Run: `npm run typecheck`
Expected: no errors (docs-only change; confirms no accidental code edits). Manually confirm every host named in `docs/hosts.md` has a matching wrapper in `scripts/skill-variants.mjs` or uses the generic AGENTS.md snippet.

- [ ] **Step 4: Commit**

```bash
git add docs/hosts.md README.md
git commit -m "docs: add per-host install guide and Copilot/universal quick starts"
```

---

### Task 5: Release integration (workflow, version, packaging)

**Files:**
- Modify: `.github/workflows/npm-package.yml`
- Modify: `scripts/package.mjs`
- Modify: `packages/mcp-server/src/server.ts` (version string)
- Modify: all `packages/*/package.json` + plugin manifests (version bump)
- Modify: `package.json`, `package-lock.json` (version bump)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: installable `release/copilot/token-saver` + `release/skills/`, a npmjs publish job, and a consistent `0.5.0` version.

- [ ] **Step 1: Add the npmjs publish job**

In `.github/workflows/npm-package.yml`, add a second job (sibling of `publish`):

```yaml
  publish-npmjs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - name: Install and build
        run: |
          npm ci
          npm run build
      - name: Publish token-saver-mcp to npmjs
        working-directory: packages/mcp-server
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if npm view "token-saver-mcp@$VERSION" version >/dev/null 2>&1; then
            echo "token-saver-mcp@$VERSION already exists on npmjs; skipping"
            exit 0
          fi
          npm publish --access public
```

Note: requires an `NPM_TOKEN` repository secret (user action, flagged in Task 6). The existing GitHub Packages `publish` job stays unchanged.

- [ ] **Step 2: Add copilot + skills to release packaging**

In `scripts/package.mjs`, add the import at the top:

```javascript
import { emitSkillVariants } from "./skill-variants.mjs";
```

Change the host loop array from `["claude", "codex", "qoder"]` to `["claude", "codex", "qoder", "copilot"]`. After the opencode copy block, add:

```javascript
await emitSkillVariants();
```

and update the final `console.log` to mention `release/copilot/token-saver` and `release/skills`.

- [ ] **Step 3: Sync versions to 0.5.0**

Change `"version": "0.4.0"` to `"version": "0.5.0"` in: `package.json`, `packages/core/package.json`, `packages/mcp-server/package.json`, `packages/claude/package.json`, `packages/codex/package.json`, `packages/opencode/package.json`, `packages/qoder/package.json`, `packages/copilot/package.json`, `packages/claude/.claude-plugin/plugin.json`, `packages/codex/plugin.json`, `packages/codex/.codex-plugin/plugin.json`, `packages/qoder/.qoder-plugin/plugin.json`. In `packages/mcp-server/src/server.ts`, change `version: "0.3.0"` to `version: "0.5.0"`. Then run `npm install` to regenerate `package-lock.json` versions.

- [ ] **Step 4: Full verification**

Run: `npm run build && npm run typecheck && npm test && npm run smoke && npm run package`
Expected: all PASS; `release/copilot/token-saver` and `release/skills/` exist; `git diff -- packages/*/dist` shows only intended bundle changes.

- [ ] **Step 5: Confirm tracked bundles are reproducible**

Run: `npm run build && git status --porcelain -- packages/*/dist`
Expected: no unexpected dist drift beyond the committed bundles (rebuild is deterministic).

- [ ] **Step 6: Commit**

`release/` is gitignored (build output, regenerated by `npm run package`); only tracked `dist` bundles are committed.

```bash
git add .github/workflows/npm-package.yml scripts/package.mjs packages/mcp-server/src/server.ts package.json package-lock.json packages/*/package.json packages/claude/.claude-plugin/plugin.json packages/codex/.codex-plugin/plugin.json packages/codex/plugin.json packages/qoder/.qoder-plugin/plugin.json packages/*/dist
git commit -m "feat: v0.5.0 multi-harness release packaging and npmjs publish job"
```

---

### Task 6: Real-host verification checkpoint (requires user)

**Files:** none (verification only; may produce follow-up fixes).

**Interfaces:**
- Consumes: built Copilot adapter + published/local MCP bin.
- Produces: confirmation the adapter works on a live host, or a concrete defect list.

This task CANNOT be completed autonomously — it needs the user's Copilot CLI install, accounts, and an `NPM_TOKEN` secret. Pause and ask the user to run these, then act on the results.

- [ ] **Step 1: Copilot CLI live verification (user)**

Ask the user to: install the Copilot hooks (`packages/copilot/hooks/hooks.json` into `.github/hooks/`), add the MCP server (`/mcp add` with `npx -y token-saver-mcp` or the local `packages/mcp-server/dist/mcp-server.js`), restart Copilot CLI, run a verbose command (e.g. a large test suite), and confirm the result shows a `[token-saver]` marker and that `output_slice` recovers lines. Confirm the exact `matcher`/script-path wiring in `hooks.json` matches the live Copilot schema; if it differs, fix `hooks.json`/wrappers and re-run Task 3 smoke.

- [ ] **Step 2: One long-tail host verification (user)**

Ask the user to configure `npx -y token-saver-mcp` + the matching skill wrapper in Cursor or Cline, then confirm the agent calls `compact_run`/`compact_search` and retrieves via `output_slice`.

- [ ] **Step 3: Publish prerequisites (user)**

Ask the user to add the `NPM_TOKEN` repository secret and confirm the `token-saver-mcp` name is available on npmjs.com (if taken, choose a fallback name and update `packages/mcp-server/package.json`, `docs/hosts.md`, and the workflow).

- [ ] **Step 4: Apply any fixes and re-verify**

For each defect found, write a failing test, fix, re-run `npm test && npm run smoke`, and commit. If no defects, record verification complete.

---

## Self-Review

**Spec coverage:**
- Deliverable 1 (publishable MCP) → Task 2 (bin/files/engines, npmjs) + Task 5 (workflow). ✓
- Deliverable 2 (Copilot adapter) → Task 3 (handler/entry/hooks/skill/tests) + Task 6 (live spike). ✓
- Deliverable 3 (universal skill + wrappers) → Task 1. ✓
- Deliverable 4 (docs) → Task 4. ✓
- Data flow / no core changes → honored (adapter reuses `handlePostToolUse`). ✓
- Error handling (fail-open, debug, npx fallbacks) → Task 3 entry + Task 4 docs. ✓
- Testing (unit, smoke, real-host) → Tasks 1/2/3 + Task 6. ✓
- Rollout (0.5.0, tracked dist, release dirs) → Task 5. ✓
- Out of scope (Amp, eviction, Aider, Gemini native) → not present. ✓

**Placeholder scan:** No TBD/TODO. The Copilot `hooks.json` matcher/path wiring is real code written to the documented schema with an explicit live-verification step (Task 6), which the spec mandates — not a deferred placeholder.

**Type consistency:** `handleCopilotPostToolUse`, `CopilotPostToolUse`, `buildVariants`, `bodyOf`, `splitFrontmatter`, `emitSkillVariants`, `SkillVariant` are defined once and referenced identically across tasks. Core signature `handlePostToolUse(payload, config, store, defaultSession)` matches `packages/core/src/hook-handler.ts:113`. `modifiedResult.textResultForLlm` / `resultType` match the verified Copilot schema.