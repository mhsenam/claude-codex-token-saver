import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function json(relative: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(repoRoot, relative), "utf8")) as Record<string, unknown>;
}

test("every host manifest carries the root package version", async () => {
  const root = await json("package.json");
  const manifests = [
    "packages/claude/.claude-plugin/plugin.json",
    "packages/codex/plugin.json",
    "packages/codex/.codex-plugin/plugin.json",
    "packages/qoder/.qoder-plugin/plugin.json",
    "packages/opencode/package.json",
    "packages/qoder/package.json",
    "packages/claude/package.json",
    "packages/codex/package.json",
    "packages/core/package.json",
    "packages/mcp-server/package.json",
  ];

  for (const manifest of manifests) {
    const parsed = await json(manifest);
    assert.equal(
      parsed.version,
      root.version,
      `${manifest} version ${parsed.version} must match root ${root.version}`,
    );
  }
});
