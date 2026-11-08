# Contributing to TokenSaver

Issues and pull requests are welcome. TokenSaver is MIT licensed; by contributing you agree your contributions are licensed under the same license.

## Development setup

Requirements: Node.js 22 or newer and Git.

```bash
git clone https://github.com/mhsenam/claude-codex-token-saver.git
cd claude-codex-token-saver
npm ci
npm test
```

## Before opening a pull request

Run the full local pipeline:

```bash
npm run typecheck   # TypeScript across all packages
npm test            # unit and protocol tests
npm run build       # bundles all hosts (dist/ is tracked; include updates if sources changed)
npm run smoke       # exercises the built Claude, Qoder, opencode, and Codex bundles
npm run benchmark   # compaction ratios; unexpected regressions need an explanation
```

The `packages/*/dist` bundles are tracked so marketplace installs work without a build step. If your change affects bundled sources, run `npm run build` and commit the updated bundles (`git diff -- packages/*/dist` should show them).

## Reporting bugs

Include a realistic output fixture for compaction bugs: the command, the host, the unexpected compacted result, and what the model should have seen. Avoid submitting logs containing credentials or private source code; scrub or synthesize first.

## Design rules that keep reviews fast

- Compaction is deterministic and local: no model calls, no network, no telemetry.
- Hook failures fail open: the original tool output must pass through if anything breaks.
- Replacements keep the original tool-output shape (content blocks, `stdout`/`stderr`, or plain string).
- Every feature works without configuration; environment variables only override defaults.
- Changes to defaults or benchmarks need a rationale in the PR description.
