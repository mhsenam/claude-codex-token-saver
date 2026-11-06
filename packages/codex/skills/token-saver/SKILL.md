---
name: token-saver
description: Reduce context usage for verbose commands, large searches, and large file reads with recoverable deterministic compaction.
---

# Token Saver

For operations expected to produce more than about 100 lines, prefer the `token-saver` MCP tools:

- `compact_run` for verbose builds, tests, installs, and other shell commands.
- `compact_search` for broad repository searches.
- `compact_read` for large files when an exact range is not required.

Use built-in tools for small outputs, exact edits, and precise file ranges. An explicit `startLine` in `compact_read` returns an exact uncompacted range.

When output contains a token-saver artifact ID, use `output_slice` with a small `startLine`/`maxLines` range to inspect omitted content. Do not rerun verbose commands solely to recover stored output. Preserve artifact IDs and exit codes in subsequent reasoning.
