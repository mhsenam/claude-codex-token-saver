import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

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

const hosts = ["claude", "codex", "opencode", "qoder", "mcp-server"];

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
  bundle("packages/mcp-server/src/server.ts", "packages/mcp-server/dist/mcp-server.js", "#!/usr/bin/env node"),
]);

await cp("packages/claude/dist/mcp-server.js", "packages/codex/dist/mcp-server.js");
await cp("packages/claude/dist/mcp-server.js", "packages/qoder/dist/mcp-server.js");
