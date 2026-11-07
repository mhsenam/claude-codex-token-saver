import { ArtifactStore } from "./artifact-store.js";
import { policyConfig } from "./config.js";
import { DedupIndex, outputHash } from "./dedup.js";
import { recordStats } from "./stats.js";
import type {
  CompactionConfig,
  CompactionResult,
  TextCompaction,
  ToolKind,
} from "./types.js";

const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const importantTestLine = /\b(?:fail(?:ed|ure|ing)?|errors?|exceptions?|assertion|unhandled|panicked|segmentation fault)\b|(?:^|\s)(?:FAIL|ERROR)(?:\s|$)/i;
const testSummaryLine = /\b(?:test suites?|tests?|passed|failures?|errors?|warnings?|duration|elapsed|exit code)\s*[:0-9]/i;
const testCommand = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck)|vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle|tsc)\b/i;
const unsafeForRewrite = /[|<>&;`$\n]/;

export function isVerboseCommand(command: string): boolean {
  if (typeof command !== "string") return false;
  if (command.length === 0 || command.length > 2_000) return false;
  if (unsafeForRewrite.test(command)) return false;
  if (command.includes("token-saver")) return false;
  return testCommand.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function rewriteVerboseCommand(options: {
  command: string;
  filePath: string;
  artifactId: string;
  tailLines?: number;
}): string {
  const tail = options.tailLines ?? 120;
  const log = shellQuote(options.filePath);
  return [
    `__ts_log=${log}`,
    `${options.command} > "$__ts_log" 2>&1`,
    "__ts_code=$?",
    `tail -n ${tail} "$__ts_log"`,
    `printf '\\n[token-saver] full output: ${options.artifactId} (exit %s); use output_slice with startLine and maxLines\\n' "$__ts_code"`,
    "exit $__ts_code",
  ].join("; ");
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
}

function truncateLine(line: string, maxLength: number): string {
  const characters = Array.from(line);
  if (characters.length <= maxLength) return line;
  return `${characters.slice(0, maxLength).join("")} … [${characters.length - maxLength} chars omitted]`;
}

function normalizedLines(input: string, config: CompactionConfig): string[] {
  return input
    .replace(ansiPattern, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .split(/\r\n|\r|\n/)
    .map((line) => truncateLine(line, config.maxLineLength));
}

function addRange(selected: Set<number>, start: number, end: number, limit: number): void {
  for (let index = Math.max(0, start); index <= Math.min(limit - 1, end); index += 1) {
    selected.add(index);
  }
}

function addHeadTail(
  selected: Set<number>,
  totalLines: number,
  head: number,
  tail: number,
  maxSelected: number,
): void {
  addRange(selected, 0, Math.min(head, maxSelected) - 1, totalLines);
  const remaining = maxSelected - selected.size;
  if (remaining > 0) addRange(selected, totalLines - Math.min(tail, remaining), totalLines - 1, totalLines);
}

function selectedIndexes(lines: string[], kind: ToolKind, config: CompactionConfig): Set<number> {
  const selected = new Set<number>();
  if (kind !== "test") {
    addHeadTail(selected, lines.length, config.headLines, config.tailLines, config.maxOutputLines);
    return selected;
  }

  const edgeBudget = Math.floor(config.maxOutputLines / 4);
  addHeadTail(
    selected,
    lines.length,
    Math.min(config.headLines, edgeBudget),
    Math.min(config.tailLines, edgeBudget),
    config.maxOutputLines,
  );

  for (let index = 0; index < lines.length && selected.size < config.maxOutputLines; index += 1) {
    if (!importantTestLine.test(lines[index]) && !testSummaryLine.test(lines[index])) continue;
    const start = Math.max(0, index - config.contextLines);
    const end = Math.min(lines.length - 1, index + config.contextLines);
    for (let context = start; context <= end && selected.size < config.maxOutputLines; context += 1) {
      selected.add(context);
    }
  }
  return selected;
}

function renderSelected(lines: string[], selected: Set<number>): { body: string[]; omitted: number } {
  const body: string[] = [];
  const sorted = [...selected].sort((left, right) => left - right);
  let previous = -1;
  let omitted = 0;

  for (const index of sorted) {
    if (index > previous + 1) {
      const start = previous + 2;
      const end = index;
      omitted += index - previous - 1;
      body.push(`[… original lines ${start}–${end} omitted …]`);
    }
    body.push(lines[index]);
    previous = index;
  }

  if (previous < lines.length - 1) {
    omitted += lines.length - previous - 1;
    body.push(`[… original lines ${previous + 2}–${lines.length} omitted …]`);
  }
  return { body, omitted };
}

function collapseAdjacent(lines: string[]): { body: string[]; omitted: number } {
  const body: string[] = [];
  let omitted = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    let end = index + 1;
    while (end < lines.length && lines[end] === line) end += 1;
    body.push(line);
    if (end - index > 1) {
      body.push(`[previous line repeated ${end - index - 1} times]`);
      omitted += end - index - 1;
    }
    index = end;
  }
  return { body, omitted };
}

interface SearchMatch {
  file: string;
  line: string;
}

function parseSearchMatch(line: string): SearchMatch | undefined {
  const match = /^(.*):(\d+)(?::\d+)?:(.*)$/.exec(line);
  if (!match || !match[1]) return undefined;
  return { file: match[1], line };
}

function renderSearch(lines: string[], config: CompactionConfig): { body: string[]; omitted: number } | undefined {
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const parsed = nonEmpty.map(parseSearchMatch);
  if (nonEmpty.length === 0 || parsed.filter(Boolean).length < nonEmpty.length / 2) return undefined;

  const groups = new Map<string, string[]>();
  const unparsed: string[] = [];
  for (let index = 0; index < nonEmpty.length; index += 1) {
    const match = parsed[index];
    if (!match) {
      unparsed.push(nonEmpty[index]);
      continue;
    }
    const matches = groups.get(match.file) ?? [];
    matches.push(match.line);
    groups.set(match.file, matches);
  }

  const body = [`[search: ${nonEmpty.length} matches across ${groups.size} files]`];
  let shown = 0;
  let omitted = Math.max(0, lines.length - nonEmpty.length);
  for (const [file, matches] of groups) {
    if (shown >= config.maxOutputLines) {
      omitted += matches.length;
      continue;
    }
    const count = Math.min(config.searchPerFile, matches.length, config.maxOutputLines - shown);
    body.push(...matches.slice(0, count));
    shown += count;
    omitted += matches.length - count;
    if (count < matches.length) body.push(`[${file}: ${matches.length - count} additional matches omitted]`);
  }
  body.push(...unparsed.slice(0, Math.max(0, config.maxOutputLines - shown)));
  omitted += Math.max(0, unparsed.length - Math.max(0, config.maxOutputLines - shown));
  return { body, omitted };
}

function result(input: string, text: string, compacted: boolean, omittedLines: number): TextCompaction {
  return {
    text,
    compacted,
    originalLines: lineCount(input),
    originalBytes: Buffer.byteLength(input),
    returnedLines: lineCount(text),
    returnedBytes: Buffer.byteLength(text),
    omittedLines,
  };
}

export function compactText(
  input: string,
  kind: ToolKind,
  config: CompactionConfig,
): TextCompaction {
  const effective = policyConfig(config, kind);
  const originalLines = lineCount(input);
  const hasLongLine = input.split(/\r\n|\r|\n/).some((line) => Array.from(line).length > effective.maxLineLength);
  if (
    !effective.enabledTools.includes(kind) ||
    (originalLines <= effective.maxOutputLines && Buffer.byteLength(input) <= effective.maxOutputBytes && !hasLongLine)
  ) {
    return result(input, input, false, 0);
  }

  const lines = normalizedLines(input, effective);
  if (kind === "search") {
    const search = renderSearch(lines, effective);
    if (search) return result(input, search.body.join("\n"), true, search.omitted);
  }

  const rendered = renderSelected(lines, selectedIndexes(lines, kind, effective));
  const collapsed = kind === "search" ? rendered : collapseAdjacent(rendered.body);
  return result(
    input,
    collapsed.body.join("\n"),
    true,
    Math.max(0, rendered.omitted + collapsed.omitted),
  );
}

export async function compactOutput(options: {
  input: string;
  kind: ToolKind;
  sessionId?: string;
  config: CompactionConfig;
  store?: ArtifactStore;
}): Promise<CompactionResult> {
  const compacted = compactText(options.input, options.kind, options.config);
  if (!compacted.compacted) return compacted;

  const store = options.store ?? new ArtifactStore(options.config);
  const sessionId = options.sessionId ?? "default";

  if (options.config.dedup) {
    const index = new DedupIndex(store.root, sessionId, options.config.retentionHours);
    const hash = outputHash(options.input);
    const existing = await index.lookup(hash);
    if (existing) {
      const preview = options.input
        .replace(ansiPattern, "")
        .split(/\r\n|\r|\n/)
        .slice(0, options.config.dedupPreviewLines)
        .join("\n");
      const stub = [
        `[token-saver] duplicate: identical output was already stored (artifactId=${existing.artifactId}, ${existing.lines} lines).`,
        preview,
        "[… remaining lines are identical to the earlier result; use output_slice to retrieve any line range …]",
      ].join("\n");
      await recordStats(store.root, {
        type: "dedup",
        session: sessionId,
        kind: options.kind,
        originalBytes: compacted.originalBytes,
        returnedBytes: Buffer.byteLength(stub),
        artifactId: existing.artifactId,
      });
      return {
        text: stub,
        compacted: true,
        deduped: true,
        artifactId: existing.artifactId,
        originalLines: compacted.originalLines,
        originalBytes: compacted.originalBytes,
        returnedLines: lineCount(stub),
        returnedBytes: Buffer.byteLength(stub),
        omittedLines: Math.max(0, compacted.originalLines - options.config.dedupPreviewLines),
      };
    }
  }

  const artifactId = await store.save(options.input, sessionId);
  const header = `[token-saver] ${options.kind}: ${compacted.originalLines} lines/${compacted.originalBytes} B → ${compacted.returnedLines} lines/${compacted.returnedBytes} B. Full output: ${artifactId}; use token-saver output_slice with startLine and maxLines.`;
  const text = `${header}\n${compacted.text}`;

  if (options.config.dedup) {
    const index = new DedupIndex(store.root, sessionId, options.config.retentionHours);
    await index.remember(outputHash(options.input), {
      artifactId,
      bytes: compacted.originalBytes,
      lines: compacted.originalLines,
      ts: Date.now(),
    });
  }
  await recordStats(store.root, {
    type: "compact",
    session: sessionId,
    kind: options.kind,
    originalBytes: compacted.originalBytes,
    returnedBytes: Buffer.byteLength(text),
    artifactId,
  });

  return {
    ...compacted,
    text,
    artifactId,
    returnedLines: lineCount(text),
    returnedBytes: Buffer.byteLength(text),
  };
}

export function detectToolKind(toolName: string, toolInput: unknown): ToolKind {
  const normalizedName = toolName.toLowerCase();
  if (normalizedName.includes("grep") || normalizedName.includes("search")) return "search";
  if (normalizedName.includes("read")) return "read";
  if (typeof toolInput === "object" && toolInput !== null && "command" in toolInput) {
    const command = (toolInput as { command?: unknown }).command;
    if (typeof command === "string" && testCommand.test(command)) return "test";
  }
  return "shell";
}
