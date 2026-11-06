import type { CompactionConfig, ToolKind } from "./types.js";

const toolKinds: ToolKind[] = ["shell", "test", "search", "read"];

export const defaultConfig: CompactionConfig = {
  enabledTools: [...toolKinds],
  maxOutputLines: 120,
  maxOutputBytes: 30_000,
  maxLineLength: 500,
  headLines: 40,
  tailLines: 60,
  searchPerFile: 8,
  contextLines: 2,
  retentionHours: 24,
  maxFileBytes: 16 * 1024 * 1024,
};

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function resolveConfig(overrides: Partial<CompactionConfig> = {}): CompactionConfig {
  const enabledTools = overrides.enabledTools?.filter((kind) => toolKinds.includes(kind));
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
  };
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
  });
}
