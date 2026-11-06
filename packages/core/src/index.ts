export { ArtifactStore, sessionDirectory } from "./artifact-store.js";
export { compactOutput, compactText, detectToolKind, isVerboseCommand, rewriteVerboseCommand } from "./compact.js";
export { configFromEnv, defaultConfig, resolveConfig } from "./config.js";
export { DedupIndex, outputHash } from "./dedup.js";
export { extractToolOutput, handlePostToolUse, reshapeToolOutput } from "./hook-handler.js";
export type { ClaudePostToolUse, PostToolUsePayload } from "./hook-handler.js";
export { preCompactInstructions } from "./pre-compact.js";
export { formatStatsSummary, recordStats, statsFileName, statsFilePath, summarizeStats } from "./stats.js";
export type { KindStats, StatsEvent, StatsSummary } from "./stats.js";
export type {
  ArtifactSlice,
  CompactionConfig,
  CompactionResult,
  TextCompaction,
  ToolKind,
} from "./types.js";
