import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const bundle = (entry, outfile) =>
  build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "eof",
  });

const hosts = ["claude", "codex", "opencode", "qoder"];

await Promise.all(hosts.map((host) => rm(`packages/${host}/dist`, { recursive: true, force: true })));
await Promise.all(hosts.map((host) => mkdir(`packages/${host}/dist`, { recursive: true })));

await Promise.all([
  bundle("packages/claude/src/post-tool-use.ts", "packages/claude/dist/post-tool-use.js"),
  bundle("packages/core/src/pre-compact-main.ts", "packages/claude/dist/pre-compact.js"),
  bundle("packages/codex/src/pre-compact.ts", "packages/codex/dist/pre-compact.js"),
  bundle("packages/qoder/src/post-tool-use.ts", "packages/qoder/dist/post-tool-use.js"),
  bundle("packages/core/src/pre-compact-main.ts", "packages/qoder/dist/pre-compact.js"),
  bundle("packages/opencode/src/plugin.ts", "packages/opencode/dist/plugin.js"),
  bundle("packages/mcp-server/src/server.ts", "packages/claude/dist/mcp-server.js"),
]);

await cp("packages/claude/dist/mcp-server.js", "packages/codex/dist/mcp-server.js");
await cp("packages/claude/dist/mcp-server.js", "packages/qoder/dist/mcp-server.js");
