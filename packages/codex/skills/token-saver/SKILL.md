---
name: token-saver
description: Run verbose operations through token-saver compact tools and recover compacted output without rerunning. Use before running test suites, builds, installs, migrations, broad searches, or large file reads expected to exceed about 100 lines of output; also when a result contains a token-saver artifact ID, or when asked about token savings.
---

# Token Saver

For operations expected to produce more than about 100 lines, use the token-saver MCP tools:

- `compact_run` for verbose builds, tests, installs, and other shell commands. Not for interactive commands or output the user must read in full.
- `compact_search` for broad repository searches; scope `paths` or `glob` when possible.
- `compact_read` for large files when an exact range is not required. Without `startLine` it applies the read compaction policy even when automatic read compaction is off; small files pass through unchanged, so use the built-in read for files under about 100 lines.

An explicit `startLine` returns an exact uncompacted range. Never edit based on a compacted preview; fetch the exact region first.

When output contains a token-saver artifact ID, call `output_slice` with `maxLines` 40-50; never omit it (the default returns 200 lines). Continue by advancing `startLine`; do not widen the window. Do not rerun a verbose command solely to recover stored output. A `[token-saver] duplicate:` result repeats an earlier output; trust its preview and slice the referenced artifactId if a specific line matters. After a fix, rerun the narrowest failing command.

To report savings, call `stats`; figures are estimates.
