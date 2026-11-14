# Multi-harness expansion — design

Date: 2026-11-14
Status: approved for planning
Sub-project: 1 of 2 (multi-harness expansion; "savings deepening" is a separate later spec)

## Goal

Extend TokenSaver beyond its four current hosts (Claude Code, Codex, opencode,
Qoder) so it can be installed in any MCP-capable agentic harness, and add one
new native automatic-compaction adapter (GitHub Copilot CLI). This sub-project
is about **coverage and adoption**, not about changing compaction quality or
extending history eviction — those belong to the later "savings deepening"
spec.

## Verified host landscape (November 2026)

Capability survey, verified against official docs. "No" means undocumented,
not tested-absent.

| Harness | Output replacement | History transform | Tier |
| --- | --- | --- | --- |
| Copilot CLI | Yes — `postToolUse.modifiedResult` | No | **Native hook (this spec)** |
| Amp | Yes — TS plugin synthesizes result | Unverified | Native (fast-follow, out of scope) |
| Cursor | MCP tool output only (`updated_mcp_tool_output`) | No | MCP + skill |
| Cline | Inject-only IDE hooks; SDK experimental | SDK only | MCP + skill |
| Zoo Code (Roo successor) | No | No | MCP + skill |
| Goose | No | No | MCP + skill |
| Windsurf / Devin | No | No | MCP + skill |
| Zed | No | No | MCP + skill |
| Factory droid | Input only | No | MCP + skill |
| Antigravity CLI (Gemini successor) | Observe-only | No | MCP + skill |
| Aider | No hooks, no MCP | No | Not feasible — excluded |

Two facts that shape scope:

- **Gemini CLI is sunset** (June 18, 2026, free/Pro/Ultra tiers) in favor of
  Antigravity CLI. No native Gemini adapter; Antigravity is covered by the
  universal MCP + skill layer.
- **Roo Code shut down** (May 2026); the community fork Zoo Code has no hooks
  yet. Covered by the universal layer, not a native adapter.

## Approach (approved: "extend in place")

Reuse every existing pattern. The only new machinery is npm publishing and a
small build-time skill-variant emitter. No new runtime compaction code.

## Deliverable 1 — publishable MCP package

`packages/mcp-server` becomes the universal install.

- Remove `private: true`; add `bin: { "token-saver-mcp": "dist/mcp-server.js" }`.
- The esbuild bundle is already self-contained (core + MCP SDK + zod inlined),
  so `npx -y token-saver-mcp` runs with zero registry configuration.
- Publish to **npmjs.com** as unscoped `token-saver-mcp`. GitHub Packages
  cannot serve a plain `npx` one-liner (it needs registry auth even for public
  packages), so the universal package goes to npmjs. The existing
  `@mhsenam/opencode-token-saver` GitHub Packages publish stays unchanged.
- Add a release-triggered workflow job using an `NPM_TOKEN` secret. Check name
  availability at implementation time; if taken, fall back to a scoped name and
  update the documented `npx` command.
- The package ships the universal skill file (Deliverable 3) so guidance
  travels with the install.
- `dist/mcp-server.js` is produced by the existing build; ensure the `files`
  field includes `dist` and `skills`.

## Deliverable 2 — Copilot CLI native adapter

New `packages/copilot/` mirroring `packages/claude/`.

- `src/post-tool-use.ts`: read stdin → shared `handlePostToolUse` → translate
  the core's `hookSpecificOutput.updatedToolOutput` into Copilot's
  `{ modifiedResult }` response shape.
- `hooks/hooks.json` with a `postToolUse` matcher.
- Bundled skill: the automatic-compaction variant (like Claude's), since
  Copilot compacts automatically.
- MCP config snippet; `dist` bundles added to `scripts/build.mjs`; handler
  tests mirroring `packages/claude/test/handler.test.ts`.
- **Fail-open** exactly like Claude: any parse/compaction error produces no
  output so the original result passes through; `TOKEN_SAVER_DEBUG=1` writes
  diagnostics to stderr.

### Known unknown — verification spike first

Copilot's exact stdin payload field names and any plugin-manifest format are
unverified. The first implementation step is a verification spike against the
hooks reference and a live Copilot CLI. Install docs cover manual setup (hooks
file + `/mcp add`) regardless, so the adapter ships even if no plugin
marketplace format exists.

## Deliverable 3 — universal skill, single-sourced

- Canonical `SKILL.md` lives at `packages/mcp-server/skills/token-saver/`.
- Content is based on the **Codex variant** (tool-selection + retrieval
  discipline). Long-tail hosts have no automatic compaction, so the agent must
  be taught to choose `compact_run` / `compact_search` / `compact_read` and to
  retrieve with bounded `output_slice` windows.
- A small `scripts/skill-variants.mjs` emits host wrappers at package time into
  `release/skills/`. Wrappers differ only in frontmatter/placement, never in
  body content:
  - Cursor `.mdc` (frontmatter)
  - Cline `.clinerules`
  - Goose `.goosehints`
  - Zed `.rules`
  - generic `AGENTS.md` snippet
  - Antigravity `.agents/skills/`
- Hosts without a dedicated wrapper (Zoo Code, Windsurf/Devin, Factory droid)
  use the generic `AGENTS.md` snippet; where a host reads a rules directory
  instead (e.g. Zoo Code `.roo/rules/`), the same body is placed there. The
  emitter never forks the body text.
- A variant-emitter test asserts body-content identity across all wrappers.

## Deliverable 4 — documentation

- New `docs/hosts.md`: per-host MCP JSON snippet, skill placement, and an
  honest capability note (on-demand compaction only; no history eviction on
  these hosts).
- README host table and quick start extended.
- `docs/hosts.md` records the verified Gemini sunset and Roo shutdown so users
  are not directed to dead platforms.

## Data flow

No changes to the compaction core, artifact store, dedup, or stats.

- **Long-tail hosts:** agent calls `compact_run` / `compact_search` /
  `compact_read` via MCP → full output stored under `~/.token-saver/outputs` →
  compacted preview + artifact ID returned → `output_slice` for exact recovery.
  The skill drives proactive tool choice; `stats` reports savings. All
  on-demand — no hooks, no eviction on these hosts.
- **Copilot CLI:** tool runs → `postToolUse` hook receives stdin → shared
  `handlePostToolUse` → adapter translates to `{ modifiedResult }` → host
  substitutes the compacted output. Same artifact store and recovery path as
  Claude.

## Error handling

- Copilot hook fails open (no output on any error); `TOKEN_SAVER_DEBUG=1` for
  stderr diagnostics.
- npx install: document Node ≥ 22, a pinned-version fallback, and a local-path
  fallback for offline/air-gapped use.
- Skill variants are build-time file copies with frontmatter — no runtime
  failure surface.

## Testing

- **Unit:** Copilot handler tests mirroring Claude's (payload translation,
  fail-open, read opt-in, output-shape preservation); variant-emitter test
  asserting content identity across wrappers.
- **Smoke:** extend `scripts/smoke.mjs` with a Copilot hook fixture and a
  bin-entry MCP handshake (`node dist/mcp-server.js` initialize).
- **Real-host verification:** Copilot CLI end-to-end plus one long-tail host
  (Cursor or Cline). This requires the user's machine/accounts, so the plan
  marks it as a checkpoint with the user, not an autonomous step.

## Rollout

- Version 0.5.0, synced across packages per existing convention; tracked
  `dist` bundles; `release/` gains `copilot/` and `skills/`.
- README host table + quick start updated.

## Out of scope

- Amp native adapter (fast-follow spec).
- Compaction-policy changes and history-eviction expansion (sub-project 2,
  "savings deepening").
- Aider (no MCP, no hooks — not feasible).
- Native Gemini adapter (platform sunset).

## Sources

- GitHub Copilot hooks reference: https://docs.github.com/en/copilot/reference/hooks-reference
- copilot-sdk post-tool-use: https://github.com/github/copilot-sdk/blob/main/docs/hooks/post-tool-use.md
- Using hooks with Copilot CLI: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
- Gemini CLI → Antigravity transition: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- Migrating from Gemini CLI: https://antigravity.google/docs/cli/gcli-migration/