export type ToolKind = "shell" | "test" | "search" | "read";

/** Budget knobs that may be overridden for one tool kind. */
export interface PolicyBudgetOverride {
  maxOutputLines?: number;
  maxOutputBytes?: number;
  headLines?: number;
  tailLines?: number;
}

export interface CompactionConfig {
  enabledTools: ToolKind[];
  maxOutputLines: number;
  maxOutputBytes: number;
  maxLineLength: number;
  headLines: number;
  tailLines: number;
  searchPerFile: number;
  contextLines: number;
  retentionHours: number;
  maxFileBytes: number;
  dedup: boolean;
  dedupPreviewLines: number;
  rewriteCommands: boolean;
  /** Per-kind budget overrides layered over the global budget. */
  policyBudgets: Partial<Record<ToolKind, PolicyBudgetOverride>>;
}

export interface TextCompaction {
  text: string;
  compacted: boolean;
  originalLines: number;
  originalBytes: number;
  returnedLines: number;
  returnedBytes: number;
  omittedLines: number;
}

export interface CompactionResult extends TextCompaction {
  artifactId?: string;
  deduped?: boolean;
}

export interface ArtifactSlice {
  artifactId: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  text: string;
}
