# token-saver-mcp

Universal, local-first MCP server for deterministic, recoverable tool-output
compaction. It shrinks verbose shell, test, search, and file-read output before
the model sees it, keeps failures, exit codes, paths, and line numbers visible,
and stores the complete original output on disk so any line range can be
recovered later. No model calls, no API keys, no cloud, no telemetry.

Works with any MCP-capable host (Cursor, Cline, Goose, Zed, Copilot CLI, ...).
Requires **Node.js 22 or newer**. Optional: [ripgrep](https://github.com/BurntSushi/ripgrep)
for `compact_search`.

## Install

Register the server in your host's MCP config. `npx` runs the published bin
directly — no clone or build step:

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "token-saver-mcp"] }
  }
}
```

## Tools

- `compact_run` — run a verbose shell command and return a compacted preview.
- `compact_search` — repository search with per-file match limits.
- `compact_read` — read a large file through the read policy; an explicit `startLine` returns an exact uncompacted range.
- `output_slice` — recover any line range from a stored artifact by `artifactId`.
- `stats` — estimated session token-savings statistics.

Compacted output carries a `[token-saver]` header naming the artifact ID; use
`output_slice` to retrieve omitted lines instead of rerunning commands. The
bundled skill (`skills/token-saver/SKILL.md`) teaches the agent when to choose
these tools.

## Per-host setup

MCP config locations and skill-wrapper placement for each host are documented
in [docs/hosts.md](https://github.com/mhsenam/claude-codex-token-saver/blob/main/docs/hosts.md).

MIT licensed. Source and native adapters for Claude Code, Codex, opencode,
Qoder, and Copilot CLI: <https://github.com/mhsenam/claude-codex-token-saver>