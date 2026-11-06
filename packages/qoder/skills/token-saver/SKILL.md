---
name: token-saver
description: Recover full tool output compacted by token-saver and prefer its compact tools for verbose commands, large searches, and large file reads. Use when a result contains a token-saver artifact ID or omitted lines, or when an operation is expected to exceed about 100 lines.
---

# Token Saver

When a result contains `[token-saver]`, use the compacted content first. Its header names the stored artifact ID; call the token-saver `output_slice` tool with that `artifactId` and a small `startLine`/`maxLines` range only when omitted details are needed. Do not rerun a verbose command solely to recover output that is already stored in an artifact. A result marked `[token-saver] duplicate:` is an exact repeat of an earlier output; trust its preview and the referenced artifact instead of requesting the content again. Preserve artifact IDs and exit codes in subsequent reasoning. The `stats` tool reports accumulated savings when asked about token usage.

For operations expected to produce more than about 100 lines, prefer the token-saver MCP tools (`mcp__token-saver__*`):

- `compact_run` for verbose builds, tests, installs, and other shell commands.
- `compact_search` for broad repository searches.
- `compact_read` for large files when an exact range is not required.

Use built-in tools for small outputs, exact edits, and precise file ranges. An explicit `startLine` in `compact_read` returns an exact uncompacted range.

The PostToolUse hook compacts verbose built-in `Bash`, `Read`, `Grep`, and `run_in_terminal` results automatically, so most large outputs already arrive compacted with an artifact ID in the header.
