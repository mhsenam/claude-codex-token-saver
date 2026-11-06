import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outputs = [
  {
    entry: "packages/claude/src/post-tool-use.ts",
    outfile: "packages/claude/dist/post-tool-use.js",
  },
  {
    entry: "packages/core/src/pre-compact-main.ts",
    outfile: "packages/claude/dist/pre-compact.js",
  },
  {
    entry: "packages/codex/src/pre-compact.ts",
    outfile: "packages/codex/dist/pre-compact.js",
  },
];

await Promise.all([
  rm("packages/claude/dist", { recursive: true, force: true }),
  rm("packages/codex/dist", { recursive: true, force: true }),
]);
await mkdir("packages/claude/dist", { recursive: true });
await mkdir("packages/codex/dist", { recursive: true });

for (const output of outputs) {
  await build({
    entryPoints: [output.entry],
    outfile: output.outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "eof",
  });
}

await build({
  entryPoints: ["packages/mcp-server/src/server.ts"],
  outfile: "packages/claude/dist/mcp-server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "eof",
});
await cp("packages/claude/dist/mcp-server.js", "packages/codex/dist/mcp-server.js");
