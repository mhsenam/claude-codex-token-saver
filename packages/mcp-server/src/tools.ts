import { exec, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ArtifactStore, compactOutput, detectToolKind } from "../../core/src/index.js";
import type { CompactionConfig } from "../../core/src/index.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function projectPath(input: string, cwd = process.cwd()): string {
  const resolved = path.resolve(cwd, input);
  if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`)) {
    throw new Error("Paths must remain inside the current project");
  }
  return resolved;
}

async function compact(text: string, kind: "shell" | "test" | "search" | "read", config: CompactionConfig, store: ArtifactStore) {
  return compactOutput({
    input: text,
    kind,
    sessionId: process.env.TOKEN_SAVER_SESSION_ID ?? "mcp",
    config,
    store,
  });
}

export async function compactRead(options: {
  filePath: string;
  startLine?: number;
  maxLines?: number;
  config: CompactionConfig;
  store: ArtifactStore;
}): Promise<string> {
  const filePath = projectPath(options.filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("compact_read requires a file");
  if (stat.size > options.config.maxFileBytes) {
    throw new Error(`File exceeds the ${options.config.maxFileBytes}-byte limit; request a line range`);
  }

  const content = await fs.readFile(filePath, "utf8");
  if (content.includes("\0")) throw new Error("Binary files are not supported");
  if (options.startLine !== undefined) {
    const allLines = content.split(/\r\n|\r|\n/);
    const start = options.startLine;
    const count = options.maxLines ?? 200;
    const selected = allLines.slice(start - 1, start - 1 + count);
    const end = selected.length === 0 ? start - 1 : start + selected.length - 1;
    return `[${options.filePath}: lines ${start}–${end} of ${allLines.length}]\n${selected.join("\n")}`;
  }

  const result = await compact(content, "read", options.config, options.store);
  return result.text;
}

export async function compactSearch(options: {
  pattern: string;
  paths?: string[];
  glob?: string;
  config: CompactionConfig;
  store: ArtifactStore;
}): Promise<string> {
  const args = ["--line-number", "--no-heading", "--color=never"];
  if (options.glob) args.push("--glob", options.glob);
  const searchPaths = (options.paths ?? ["."]).map((searchPath) => projectPath(searchPath));
  args.push(options.pattern, ...searchPaths);
  let stdout: string;
  let stderr = "";
  try {
    const result = await execFileAsync("rg", args, {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: options.config.maxFileBytes,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const processError = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (processError.code === 1 && !processError.stderr) return "No matches found.";
    if (processError.code === "ENOENT") throw new Error("ripgrep (rg) is required for compact_search");
    stdout = processError.stdout ?? "";
    stderr = processError.stderr ?? processError.message;
    if (!stdout) throw new Error(stderr);
  }

  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const result = await compact(combined, "search", options.config, options.store);
  return result.text;
}

export async function compactRun(options: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  config: CompactionConfig;
  store: ArtifactStore;
}): Promise<string> {
  const cwd = projectPath(options.cwd ?? ".");
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execAsync(options.command, {
      cwd,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: options.config.maxFileBytes,
      windowsHide: true,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const processError = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    stdout = processError.stdout ?? "";
    stderr = processError.stderr ?? "";
    exitCode = typeof processError.code === "number" ? processError.code : 1;
    if (!stdout && !stderr) stderr = processError.message;
  }

  const kind = detectToolKind("Bash", { command: options.command });
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const result = await compact(combined, kind, options.config, options.store);
  return `${result.text}\n[exit code: ${exitCode}]`;
}

export async function outputSlice(options: {
  artifactId: string;
  startLine?: number;
  maxLines?: number;
  store: ArtifactStore;
}): Promise<string> {
  const slice = await options.store.readSlice(
    options.artifactId,
    options.startLine ?? 1,
    options.maxLines ?? 200,
  );
  return `[${slice.artifactId}: lines ${slice.startLine}–${slice.endLine} of ${slice.totalLines}]\n${slice.text}`;
}
