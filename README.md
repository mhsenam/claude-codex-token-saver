# TokenSaver

### Reduce Claude Code and Codex token usage without losing tool output

TokenSaver is a local-first context optimization plugin for **Claude Code** and **OpenAI Codex**. It compacts verbose command logs, test failures, repository searches, and large file reads before they consume your model context. The complete output remains available locally whenever you need it.

[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-6b4fbb)](https://code.claude.com/docs/en/plugins/overview)
[![Codex plugin](https://img.shields.io/badge/OpenAI%20Codex-plugin-111111)](https://developers.openai.com/plugins/build/plugins)

## Why TokenSaver?

Coding agents can read thousands of lines of logs, search matches, and source code into context. Those tool results are then resent in subsequent model requests, increasing token usage and leaving less room for your actual task.

TokenSaver uses **deterministic local compaction**, not another AI summarization step:

- No additional model calls or API keys.
- No cloud processing or telemetry.
- No lossy summary of the underlying output.
- Full output recovery by exact line range.
- Original exit codes, failures, paths, and line numbers remain visible.

## Features

| Capability | Claude Code | Codex |
| --- | --- | --- |
| Compact verbose shell and test output | Automatic `PostToolUse` hook | `compact_run` MCP tool |
| Compact broad repository searches | Automatic `Grep` hook | `compact_search` MCP tool |
| Compact large file reads | Automatic `Read` hook | `compact_read` MCP tool |
| Preserve explicitly requested file ranges | Yes | Yes |
| Retrieve omitted output | `output_slice` | `output_slice` |
| Improve automatic context compaction | `PreCompact` guidance | `PreCompact` guidance |
| Store full output locally | Yes | Yes |

Additional behavior:

- Removes ANSI escape sequences from compacted previews.
- Collapses consecutive duplicate lines.
- Preserves test failures and nearby stack traces.
- Groups search results by file with per-file limits.
- Truncates exceptionally long lines, including Unicode-safe truncation.
- Fails open: the original result passes through if compaction fails.
- Supports configurable retention and output limits.

## Quick start

### Prerequisites

- **Node.js 22 or newer**
- Claude Code, Codex CLI, or a Codex host with plugin support
- Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) for `compact_search`

### Install for Claude Code

```bash
claude plugin marketplace add mhsenam/claude-codex-token-saver
claude plugin install token-saver@token-saver
```

Restart Claude Code after installation. TokenSaver will automatically compact large `Bash`, `Read`, and `Grep` results.

### Install for Codex

```bash
codex plugin marketplace add mhsenam/claude-codex-token-saver
codex plugin add token-saver@token-saver
codex plugin list
```

Restart your Codex host and review/trust the bundled hook when prompted. Codex uses TokenSaver's MCP tools because its documented `PostToolUse` hooks do not currently provide Claude-style tool-output replacement.

For verbose operations, ask Codex to use the tools directly:

```text
Run the test suite with compact_run and inspect only the failures.
Search for authentication middleware with compact_search.
Read this large file with compact_read, then retrieve any missing lines you need.
```

The bundled skill also teaches Codex when to select these tools.

## Example

A 2,000-line command log becomes a small preview with head, tail, and important lines:

```text
[token-saver] shell: 2000 lines/128689 B → 104 lines/6420 B. Full output: session.…; use token-saver output_slice with startLine and maxLines.
progress 0% chunk 0 …
[… original lines 41–1940 omitted …]
FAIL: final assertion failed
[exit code: 1]
```

To recover lines 450–469 without rerunning the command:

```json
{
  "artifactId": "session.…",
  "startLine": 450,
  "maxLines": 20
}
```

Pass that object to the `output_slice` MCP tool.

## Benchmarks

Run the reproducible synthetic fixtures with:

```bash
npm run benchmark
```

Current fixture results:

| Fixture | Original | Compacted | Estimated reduction |
| --- | ---: | ---: | ---: |
| Verbose shell log | 128,689 B | 6,622 B | 94.9% |
| Test failures | 33,377 B | 2,293 B | 93.1% |
| Repository search | 94,899 B | 6,594 B | 93.0% |
| Large source read | 69,779 B | 4,840 B | 93.1% |

These numbers measure **tool-output bytes and bytes-divided-by-four token estimates**, not provider billing. Total session savings will be lower and vary by workflow because prompts, model responses, cached context, and small tool results are not compacted.

## Configuration

TokenSaver works without configuration. Set environment variables to override defaults:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `TOKEN_SAVER_TOOLS` | `shell,test,search,read` | Enabled compaction policies |
| `TOKEN_SAVER_MAX_LINES` | `120` | Output-line budget |
| `TOKEN_SAVER_MAX_BYTES` | `30000` | Approximate output-byte budget |
| `TOKEN_SAVER_MAX_LINE_LENGTH` | `500` | Characters retained per long line |
| `TOKEN_SAVER_HEAD_LINES` | `40` | Lines retained from the beginning |
| `TOKEN_SAVER_TAIL_LINES` | `60` | Lines retained from the end |
| `TOKEN_SAVER_SEARCH_PER_FILE` | `8` | Search matches retained per file |
| `TOKEN_SAVER_RETENTION_HOURS` | `24` | Full-output artifact retention |
| `TOKEN_SAVER_DATA_DIR` | `~/.token-saver/outputs` | Artifact storage directory |
| `TOKEN_SAVER_DEBUG` | unset | Set to `1` for Claude hook errors on stderr |

Set `TOKEN_SAVER_TOOLS` to a comma-separated subset of policies to limit automatic compaction, or disable the plugin for a complete bypass.

## How it works

```text
Verbose tool output
        |
        v
  Full output ------------------> Local artifact store
        |                              |
        v                              |
Deterministic policy                   |
        |                              |
        v                              |
Compact model-visible result           |
        |                              |
        +-------- artifact ID ---------+
                       |
                       v
               output_slice retrieval
```

Compaction policies are shared across hosts. Claude adds native hook adapters; Codex registers the same functionality through MCP tools and a skill.

## Privacy and security

- TokenSaver has no analytics, network service, or model API integration.
- Full tool output is written locally with restrictive file permissions where supported.
- Artifacts may contain the same sensitive information as the original logs. Use a suitable retention period and avoid printing secrets in commands.
- `compact_run` executes the shell command requested by the agent. Only install and enable plugins you trust, and review commands as you would with a built-in shell tool.
- File and search path inputs are restricted to the current project; a shell command itself has the permissions of the user running Codex.
- Hook failures return the original output instead of blocking the coding session.

## Local development

```bash
git clone https://github.com/mhsenam/claude-codex-token-saver.git
cd claude-codex-token-saver
npm ci
npm test
npm run build
npm run smoke
npm run package
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Type-check all TypeScript sources |
| `npm test` | Run unit and protocol tests |
| `npm run build` | Bundle both plugin adapters |
| `npm run smoke` | Exercise the built Claude hook and MCP server |
| `npm run benchmark` | Measure synthetic compaction ratios |
| `npm run package` | Create installable directories under `release/` |
| `claude plugin validate packages/claude` | Validate the Claude plugin |

The `packages/*/dist` bundles are tracked so marketplace installs work without a build step.

## Project structure

```text
packages/
├── core/        # Compaction policies, configuration, artifact storage
├── mcp-server/  # compact_read, compact_search, compact_run, output_slice
├── claude/      # Claude manifest, hooks, skill, bundled runtime
└── codex/       # Codex manifest, hooks, skill, bundled runtime
benchmarks/      # Reproducible synthetic fixtures
scripts/         # Build, package, and smoke-test automation
```

## Limitations

- TokenSaver cannot guarantee a specific reduction in provider-reported token usage or cost.
- Small outputs pass through unchanged by design.
- Lossy context can still result from aggressive limits; retrieve the artifact when exact omitted details matter.
- Codex does not currently have feature parity with Claude's automatic `PostToolUse` output replacement, so its MCP tools must be selected by the agent or requested explicitly.
- Very large commands that exceed the process buffer must be narrowed or split before compaction.

## Contributing

Issues and pull requests are welcome. Include a realistic output fixture for compaction bugs, run `npm test` and `npm run smoke`, and avoid submitting logs containing credentials or private source code.
