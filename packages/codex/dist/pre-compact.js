// packages/core/src/config.ts
var toolKinds = ["shell", "test", "search", "read"];
var defaultConfig = {
  enabledTools: [...toolKinds],
  maxOutputLines: 120,
  maxOutputBytes: 3e4,
  maxLineLength: 500,
  headLines: 40,
  tailLines: 60,
  searchPerFile: 8,
  contextLines: 2,
  retentionHours: 24,
  maxFileBytes: 16 * 1024 * 1024
};

// packages/core/src/pre-compact.ts
var preCompactInstructions = "Preserve the current objective, pending tasks, user constraints, modified file paths, exact errors, and decisions. Omit redundant tool output while retaining token-saver artifact IDs needed for retrieval.";

// packages/codex/src/pre-compact.ts
process.stdout.write(preCompactInstructions);
