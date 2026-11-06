// packages/core/src/config.ts
var toolKinds = ["shell", "test", "search", "read"];
var defaultConfig = {
  // "read" is deliberately not enabled by default: an agent that edits a file it
  // has only seen as a head/tail preview produces wrong edits. Reads stay fully
  // recoverable through the explicit compact_read tool; enable automatic read
  // compaction with TOKEN_SAVER_TOOLS=shell,test,search,read.
  enabledTools: toolKinds.filter((kind) => kind !== "read"),
  maxOutputLines: 120,
  maxOutputBytes: 3e4,
  maxLineLength: 500,
  headLines: 40,
  tailLines: 60,
  searchPerFile: 8,
  contextLines: 2,
  retentionHours: 24,
  maxFileBytes: 16 * 1024 * 1024,
  dedup: true,
  dedupPreviewLines: 20,
  rewriteCommands: true
};

// packages/core/src/pre-compact.ts
var preCompactInstructions = "Preserve the current objective, pending tasks, user constraints, modified file paths, exact errors, and decisions. Omit redundant tool output while retaining token-saver artifact IDs needed for retrieval.";

// packages/codex/src/pre-compact.ts
process.stdout.write(preCompactInstructions);
