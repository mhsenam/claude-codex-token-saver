import type { CompactionConfig, PolicyBudgetOverride, ToolKind } from "./types.js";

const toolKinds: ToolKind[] = ["shell", "test", "search", "read"];

export const defaultConfig: CompactionConfig = {
  // "read" is deliberately not enabled by default: an agent that edits a file it
  // has only seen as a head/tail preview produces wrong edits. Reads stay fully
  // recoverable through the explicit compact_read tool; enable automatic read
  // compaction with TOKEN_SAVER_TOOLS=shell,test,search,read.
  enabledTools: toolKinds.filter((kind) => kind !== "read"),
  maxOutputLines: 120,
  maxOutputBytes: 30_000,
  maxLineLength: 500,
  headLines: 40,
  tailLines: 60,
  searchPerFile: 8,
  contextLines: 2,
  retentionHours: 24,
  maxFileBytes: 16 * 1024 * 1024,
  dedup: true,
  dedupPreviewLines: 20,
  rewriteCommands: true,
  policyBudgets: {},
};

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  return fallback;
}

/**
 * Layer a single tool kind's budget overrides over the global budget.
 * Returns the config unchanged when no override exists for the kind.
 */
export function policyConfig(config: CompactionConfig, kind: ToolKind): CompactionConfig {
  const override = config.policyBudgets[kind];
  if (!override) return config;
  return {
    ...config,
    maxOutputLines: override.maxOutputLines ?? config.maxOutputLines,
    maxOutputBytes: override.maxOutputBytes ?? config.maxOutputBytes,
    headLines: override.headLines ?? config.headLines,
    tailLines: override.tailLines ?? config.tailLines,
  };
}

export function resolveConfig(overrides: Partial<CompactionConfig> = {}): CompactionConfig {
  const enabledTools = overrides.enabledTools?.filter((kind) => toolKinds.includes(kind));
  const policyBudgets: CompactionConfig["policyBudgets"] = {};
  for (const kind of toolKinds) {
    const override = overrides.policyBudgets?.[kind];
    if (override && Object.keys(override).length > 0) policyBudgets[kind] = { ...override };
  }
  return {
    enabledTools: enabledTools ?? [...defaultConfig.enabledTools],
    maxOutputLines: overrides.maxOutputLines ?? defaultConfig.maxOutputLines,
    maxOutputBytes: overrides.maxOutputBytes ?? defaultConfig.maxOutputBytes,
    maxLineLength: overrides.maxLineLength ?? defaultConfig.maxLineLength,
    headLines: overrides.headLines ?? defaultConfig.headLines,
    tailLines: overrides.tailLines ?? defaultConfig.tailLines,
    searchPerFile: overrides.searchPerFile ?? defaultConfig.searchPerFile,
    contextLines: overrides.contextLines ?? defaultConfig.contextLines,
    retentionHours: overrides.retentionHours ?? defaultConfig.retentionHours,
    maxFileBytes: overrides.maxFileBytes ?? defaultConfig.maxFileBytes,
    dedup: overrides.dedup ?? defaultConfig.dedup,
    dedupPreviewLines: overrides.dedupPreviewLines ?? defaultConfig.dedupPreviewLines,
    rewriteCommands: overrides.rewriteCommands ?? defaultConfig.rewriteCommands,
    policyBudgets,
  };
}

/**
 * Parse per-policy budget overrides from the environment. Each tool kind
 * accepts the same budget variables with the kind as a suffix, for example
 * TOKEN_SAVER_MAX_LINES_TEST=200 or TOKEN_SAVER_MAX_BYTES_SHELL=10000.
 */
function policyBudgetsFromEnv(env: NodeJS.ProcessEnv): Partial<Record<ToolKind, PolicyBudgetOverride>> {
  const budgets: Partial<Record<ToolKind, PolicyBudgetOverride>> = {};
  for (const kind of toolKinds) {
    const suffix = kind.toUpperCase();
    const override: PolicyBudgetOverride = {};
    const maxOutputLines = integer(env[`TOKEN_SAVER_MAX_LINES_${suffix}`], 0, 10, 2_000);
    if (maxOutputLines > 0) override.maxOutputLines = maxOutputLines;
    const maxOutputBytes = integer(env[`TOKEN_SAVER_MAX_BYTES_${suffix}`], 0, 1_000, 2_000_000);
    if (maxOutputBytes > 0) override.maxOutputBytes = maxOutputBytes;
    const headLines = integer(env[`TOKEN_SAVER_HEAD_LINES_${suffix}`], -1, 0, 500);
    if (headLines >= 0) override.headLines = headLines;
    const tailLines = integer(env[`TOKEN_SAVER_TAIL_LINES_${suffix}`], -1, 0, 500);
    if (tailLines >= 0) override.tailLines = tailLines;
    if (Object.keys(override).length > 0) budgets[kind] = override;
  }
  return budgets;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): CompactionConfig {
  const enabledTools = env.TOKEN_SAVER_TOOLS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value): value is ToolKind => toolKinds.includes(value as ToolKind));

  return resolveConfig({
    enabledTools,
    maxOutputLines: integer(env.TOKEN_SAVER_MAX_LINES, defaultConfig.maxOutputLines, 10, 2_000),
    maxOutputBytes: integer(env.TOKEN_SAVER_MAX_BYTES, defaultConfig.maxOutputBytes, 1_000, 2_000_000),
    maxLineLength: integer(env.TOKEN_SAVER_MAX_LINE_LENGTH, defaultConfig.maxLineLength, 80, 10_000),
    headLines: integer(env.TOKEN_SAVER_HEAD_LINES, defaultConfig.headLines, 0, 500),
    tailLines: integer(env.TOKEN_SAVER_TAIL_LINES, defaultConfig.tailLines, 0, 500),
    searchPerFile: integer(env.TOKEN_SAVER_SEARCH_PER_FILE, defaultConfig.searchPerFile, 1, 100),
    retentionHours: integer(env.TOKEN_SAVER_RETENTION_HOURS, defaultConfig.retentionHours, 1, 720),
    dedup: flag(env.TOKEN_SAVER_DEDUP, defaultConfig.dedup),
    dedupPreviewLines: integer(env.TOKEN_SAVER_DEDUP_PREVIEW_LINES, defaultConfig.dedupPreviewLines, 1, 200),
    policyBudgets: policyBudgetsFromEnv(env),
    // The rewrite template is POSIX sh; on Windows the host shell may not be bash,
    // so rewriting stays opt-in there until TOKEN_SAVER_REWRITE=1 is set explicitly.
    rewriteCommands: flag(
      env.TOKEN_SAVER_REWRITE,
      defaultConfig.rewriteCommands && process.platform !== "win32",
    ),
  });
}
