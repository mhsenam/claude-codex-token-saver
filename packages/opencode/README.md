# opencode-token-saver

[TokenSaver](https://github.com/mhsenam/claude-codex-token-saver) for [opencode](https://opencode.ai). Compacts verbose `bash`, `read`, and `grep` tool output before it enters model context. The complete output is stored locally and recoverable by exact line range with the bundled `output_slice` tool.

Compaction is deterministic and local: no additional model calls, no cloud processing, and no telemetry.

## Install

Add the package to the `plugin` array in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-saver"]
}
```

opencode installs npm plugins automatically at startup.

Alternative drop-in install: copy `dist/plugin.js` into `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global) as `token-saver.js`.

## How it works

A `tool.execute.after` hook stores the full output of oversized `bash`, `read`, and `grep` results in `~/.token-saver/outputs`, then replaces the model-visible output with a compact preview:

```text
[token-saver] test: 500 lines/12345 B → 87 lines/5432 B. Full output: session.<uuid>; use token-saver output_slice with startLine and maxLines.
[first lines]
[… original lines 41–460 omitted …]
FAIL: final assertion failed
[last lines]
```

Call `output_slice` with the artifact ID to retrieve any line range. Explicitly ranged reads (`offset`/`limit`) pass through uncompacted.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `TOKEN_SAVER_TOOLS` | `shell,test,search,read` | Enabled compaction policies |
| `TOKEN_SAVER_MAX_LINES` | `120` | Output-line budget |
| `TOKEN_SAVER_MAX_BYTES` | `30000` | Approximate output-byte budget |
| `TOKEN_SAVER_RETENTION_HOURS` | `24` | Full-output artifact retention |
| `TOKEN_SAVER_DATA_DIR` | `~/.token-saver/outputs` | Artifact storage directory |

The full variable list is documented in the [repository README](https://github.com/mhsenam/claude-codex-token-saver#configuration).

## Notes and limitations

- The hook compacts opencode's built-in `bash`, `read`, and `grep` tools only; MCP tool outputs are not hook-addressable in opencode.
- opencode applies its own truncation to oversized tool output before plugins run, so artifacts capture the post-truncation text.
- The opencode TUI may render the original output while the model receives the compacted version (upstream display behavior).
