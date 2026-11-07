# History eviction design

A tool result that TokenSaver compacts is stored as a local artifact, but the
compact preview still travels in the conversation history. Every later request
in the session re-sends that preview. For long sessions this is the largest
remaining cost after initial compaction: a 6 KB preview resent 40 times costs
more than the original output did once.

Eviction replaces old verbose tool results in the outgoing request with a
one-line placeholder that references the artifact, so later requests carry
tens of bytes instead of kilobytes while exact recovery stays available
through `output_slice`.

## Constraints

**Hooks only see the present.** Claude Code, opencode, and Qoder hooks fire
when a tool result is produced; they can replace that result but cannot reach
turns already in history. Codex has no output replacement at all. Any eviction
mechanism must therefore run inside an existing history-rewriting moment.

**Cache economics.** Rewriting any prefix of the request invalidates the
prompt-cache from that point. Cache writes bill at 1.25x and cache reads near
0.1x, so an eviction that rewrites an early turn and saves 5 KB can cost more
than it saves if the invalidated uncached suffix is large. Eviction must be
batched (rewrite many results in one request) and thresholded (only when the
evicted bytes clearly exceed the re-caching cost of the suffix).

**Local and deterministic.** No model calls, no telemetry. Decisions come from
`stats.jsonl` and configuration only.

## Phase 1 (shipped in 0.4.0): eviction at auto-compact time

Every host already rewrites history at its own auto-compact boundary, and
TokenSaver already feeds that compactor guidance through PreCompact hooks
(Claude Code, Qoder, Codex) and opencode's `experimental.session.compacting`.
This is a history-rewriting moment where the cache is being invalidated
regardless, so eviction guidance there costs nothing extra.

Implementation (`packages/core/src/pre-compact.ts`, `pre-compact-main.ts`):

1. The hook reads the host's stdin payload and takes `session_id` (fail-open:
   without a payload the static guidance is printed, unchanged from 0.3).
2. It reads `stats.jsonl` and aggregates the session's compact and dedup
   events per artifact, oldest first.
3. Once the session holds at least `minArtifacts` (default 3) artifacts
   totalling at least `minBytes` (default 100 KB, `TOKEN_SAVER_EVICTION_MIN_BYTES`),
   the hook appends eviction guidance: the host's compactor may replace
   verbose tool results from the listed artifacts with a single placeholder
   line (`[token-saver artifact <id>: full output stored locally; retrieve
   exact lines with output_slice]`), oldest first, preserving the newest 2
   exchanges verbatim and every exact error message.
4. `TOKEN_SAVER_EVICTION=0` disables the whole feature; any error falls back
   to the static text.

opencode wires the same guidance in-process through
`buildPreCompactInstructions` with the live session ID and store root.

## Phase 2 (shipped in 0.4.0): continuous eviction on opencode

opencode v2 exposes `experimental.chat.messages.transform`, a session hook that
hands the plugin the full mutable message list before every LLM call. That is
the one host where continuous eviction is implementable today
(`packages/opencode/src/eviction.ts`):

- Candidates: completed tool parts whose output carries a token-saver header
  (compacted preview or duplicate stub) referencing an artifact of at least
  1 KB; everything else is never touched.
- Ordering: the most recent `TOKEN_SAVER_EVICTION_KEEP_RECENT` (default 3)
  candidates stay verbatim; older ones are eviction candidates.
- Verification: each candidate's artifact must still exist on disk (expired
  or missing artifacts are skipped), so a placeholder never outlives its
  recovery path.
- Batching: candidates are rewritten only when the total bytes removed from
  the request clear `TOKEN_SAVER_EVICTION_MIN_NET_SAVINGS` (default 6 KB), so
  the 1.25x cache-write tax is only paid when it nets out positive.
- Steady-state cost: after eviction the placeholder no longer matches the
  parser, and keep-recent candidates skip the disk check, so per-call
  overhead decays to zero.
- Measurement: each rewrite records an `evict` stats event with the saved
  bytes; the `stats` tool reports the totals.

Claude Code is deliberately excluded from continuous rewriting: its own
microcompaction (on by default, keeps roughly the 3 most recent tool results)
already clears old results, and TokenSaver's artifact store is the recovery
path for exactly those clearings. Rewriting history there would pay the cache
tax for nothing. Codex and Qoder stay on Phase 1 until they ship comparable
request-transform APIs.

Evidence to respect: arXiv 2607.12161 ("Token Reduction Is Not Cost
Reduction") measured a 38% token cut turning into +6.8% billed cost, and
history-rewriting tools lose roughly 20% of their cache hit rate. The batch
threshold and keep-recent window are the countermeasures; compare
provider-reported usage against a plugin-off baseline.

## Phase 3: proactive narrowing

For hosts where compaction at the source is available (opencode's
`TOKEN_SAVER_REWRITE`), long-running commands can be launched already narrowed
(`... | tail -n 200`), so the expensive result never enters history. Extending
the whitelist and making the tail configurable per command class overlaps
with per-policy budgets (`TOKEN_SAVER_MAX_LINES_*`).

## Measurement plan

- Track per-session: evicted-artifact count and bytes (new `evict` stats
  event in phase 2), retrievals of evicted artifacts (placeholder use), and
  the ratio of retrieved-to-evicted bytes as the quality signal.
- The quality guardrail: if agents frequently retrieve evicted ranges
  (retrievals/evictions above ~0.3 by count), thresholds are too aggressive.

## Risks

- **Placeholder confusion:** the model may cite an evicted result as if it
  were present. Mitigation: the placeholder names the artifact and the
  retrieval tool; the bundled skills already teach `output_slice` semantics.
- **Double compaction:** the host compactor may both apply eviction guidance
  and summarize the same result. Mitigation: guidance instructs replace-or-
  keep, never re-summarize an artifact-backed result.
- **Retention expiry:** evicted placeholders outliving their artifacts
  (default 24h retention) lose their recovery path. Mitigation: guidance only
  names artifacts recorded within the retention window.
