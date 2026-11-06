import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArtifactStore, compactOutput, defaultConfig } from "../packages/core/src/index.js";
import type { ToolKind } from "../packages/core/src/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-benchmark-"));
const store = new ArtifactStore(defaultConfig, root);
const fixtures: Array<{ name: string; kind: ToolKind; input: string }> = [
  {
    name: "verbose shell log",
    kind: "shell",
    input: Array.from({ length: 2_000 }, (_, index) => `progress ${index % 100}% chunk ${index} ${"payload ".repeat(5)}`).join("\n"),
  },
  {
    name: "test failures",
    kind: "test",
    input: Array.from({ length: 1_500 }, (_, index) => index % 250 === 0 ? `FAIL: assertion ${index}` : `running test case ${index}`).join("\n"),
  },
  {
    name: "repository search",
    kind: "search",
    input: Array.from({ length: 100 }, (_, file) => Array.from({ length: 20 }, (_, line) => `src/module-${file}/file.ts:${line + 1}:const token = "value";`).join("\n")).join("\n"),
  },
  {
    name: "large source read",
    kind: "read",
    input: Array.from({ length: 1_500 }, (_, index) => `export function function${index}() { return ${index}; }`).join("\n"),
  },
];

try {
  const measurements = [];
  for (const fixture of fixtures) {
    const result = await compactOutput({ ...fixture, config: defaultConfig, store });
    const originalTokens = Math.ceil(result.originalBytes / 4);
    const returnedTokens = Math.ceil(result.returnedBytes / 4);
    measurements.push({
      fixture: fixture.name,
      originalBytes: result.originalBytes,
      returnedBytes: result.returnedBytes,
      originalEstimatedTokens: originalTokens,
      returnedEstimatedTokens: returnedTokens,
      estimatedReductionPercent: Number((100 * (1 - returnedTokens / originalTokens)).toFixed(1)),
      artifactId: result.artifactId,
    });
  }
  console.log(JSON.stringify({ tokenEstimate: "UTF-8 bytes / 4; not provider billing data", measurements }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
