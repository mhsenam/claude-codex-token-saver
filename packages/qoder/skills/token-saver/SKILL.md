---
name: token-saver
description: Prefer token-saver compact tools for operations expected to exceed about 100 lines (tests, builds, installs, broad searches, large reads), and recover omitted lines from compacted results. Use when about to run a verbose command, when a result shows a [token-saver] marker or artifact ID, or when asked about token usage or savings.
---

# Token Saver

The PostToolUse hook compacts verbose `Bash`, `Grep`, and `run_in_terminal` results automatically (Read compaction is off by default); expect large outputs to arrive pre-compacted.

For operations expected to produce more than about 100 lines, prefer the token-saver MCP tools:

- `compact_run` for verbose builds, tests, installs, and other shell commands. Not for interactive commands or output the user must read in full.
- `compact_search` for broad repository searches; scope `paths` or `glob` when possible.
- `compact_read` for large files; it always compacts without `startLine`, even for short files.

Use built-in tools for small outputs and exact ranges. Never edit a file seen only as a compacted preview; fetch the exact region first.

When a result shows a `[token-saver]` marker, call `output_slice` with the header's `artifactId` and `maxLines` 40-50; never omit it (the default returns 200 lines). Continue by advancing `startLine`; do not widen the window. Do not rerun a verbose command solely to recover stored output. A `[token-saver] duplicate:` result repeats an earlier output; trust its preview and slice the referenced artifactId if needed. After a fix, rerun the narrowest failing command.

To report savings, call `stats`; figures are estimates.
