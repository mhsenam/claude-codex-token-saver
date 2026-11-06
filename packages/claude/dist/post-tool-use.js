// packages/core/src/artifact-store.ts
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
var artifactPattern = /^([a-zA-Z0-9_-]{1,64})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
function sessionKey(sessionId) {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) return sessionId;
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}
function lines(text) {
  return text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
}
var ArtifactStore = class {
  root;
  retentionHours;
  lastCleanup = 0;
  constructor(config, root) {
    this.root = root ?? process.env.TOKEN_SAVER_DATA_DIR ?? path.join(os.homedir(), ".token-saver", "outputs");
    this.retentionHours = config.retentionHours;
  }
  async save(output, sessionId = "default") {
    const session = sessionKey(sessionId);
    const id = randomUUID();
    const directory = path.join(this.root, session);
    await fs.mkdir(directory, { recursive: true, mode: 448 });
    await fs.writeFile(path.join(directory, `${id}.log`), output, { encoding: "utf8", mode: 384, flag: "wx" });
    await this.cleanupExpired();
    return `${session}.${id}`;
  }
  async readSlice(artifactId, startLine = 1, maxLines = 200) {
    const match = artifactPattern.exec(artifactId);
    if (!match) throw new Error("Invalid token-saver artifact ID");
    if (!Number.isInteger(startLine) || startLine < 1) throw new Error("startLine must be a positive integer");
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 1e3) {
      throw new Error("maxLines must be between 1 and 1000");
    }
    const filePath = path.join(this.root, match[1], `${match[2]}.log`);
    const output = await fs.readFile(filePath, "utf8");
    const allLines = lines(output);
    const start = Math.min(startLine - 1, allLines.length);
    const selected = allLines.slice(start, start + maxLines);
    const endLine = selected.length === 0 ? start : start + selected.length;
    return {
      artifactId,
      startLine: start + 1,
      endLine,
      totalLines: allLines.length,
      text: selected.join("\n")
    };
  }
  async cleanupExpired() {
    const now = Date.now();
    if (now - this.lastCleanup < 60 * 60 * 1e3) return;
    this.lastCleanup = now;
    const cutoff = now - this.retentionHours * 60 * 60 * 1e3;
    let sessions;
    try {
      sessions = await fs.readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const session of sessions) {
      if (!session.isDirectory() || !/^[a-zA-Z0-9_-]{1,64}$/.test(session.name)) continue;
      const directory = path.join(this.root, session.name);
      const files = await fs.readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/^[0-9a-f-]{36}\.log$/.test(file.name)) continue;
        const filePath = path.join(directory, file.name);
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) await fs.rm(filePath);
      }
      const remaining = await fs.readdir(directory);
      if (remaining.length === 0) await fs.rmdir(directory);
    }
  }
};

// packages/core/src/compact.ts
var ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
var importantTestLine = /\b(?:fail(?:ed|ure|ing)?|errors?|exceptions?|assertion|unhandled|panicked|segmentation fault)\b|(?:^|\s)(?:FAIL|ERROR)(?:\s|$)/i;
var testSummaryLine = /\b(?:test suites?|tests?|passed|failures?|errors?|warnings?|duration|elapsed|exit code)\s*[:0-9]/i;
var testCommand = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck)|vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle|tsc)\b/i;
function lineCount(text) {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
}
function truncateLine(line, maxLength) {
  const characters = Array.from(line);
  if (characters.length <= maxLength) return line;
  return `${characters.slice(0, maxLength).join("")} \u2026 [${characters.length - maxLength} chars omitted]`;
}
function normalizedLines(input, config) {
  return input.replace(ansiPattern, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").split(/\r\n|\r|\n/).map((line) => truncateLine(line, config.maxLineLength));
}
function addRange(selected, start, end, limit) {
  for (let index = Math.max(0, start); index <= Math.min(limit - 1, end); index += 1) {
    selected.add(index);
  }
}
function addHeadTail(selected, totalLines, head, tail, maxSelected) {
  addRange(selected, 0, Math.min(head, maxSelected) - 1, totalLines);
  const remaining = maxSelected - selected.size;
  if (remaining > 0) addRange(selected, totalLines - Math.min(tail, remaining), totalLines - 1, totalLines);
}
function selectedIndexes(lines2, kind, config) {
  const selected = /* @__PURE__ */ new Set();
  if (kind !== "test") {
    addHeadTail(selected, lines2.length, config.headLines, config.tailLines, config.maxOutputLines);
    return selected;
  }
  const edgeBudget = Math.floor(config.maxOutputLines / 4);
  addHeadTail(
    selected,
    lines2.length,
    Math.min(config.headLines, edgeBudget),
    Math.min(config.tailLines, edgeBudget),
    config.maxOutputLines
  );
  for (let index = 0; index < lines2.length && selected.size < config.maxOutputLines; index += 1) {
    if (!importantTestLine.test(lines2[index]) && !testSummaryLine.test(lines2[index])) continue;
    const start = Math.max(0, index - config.contextLines);
    const end = Math.min(lines2.length - 1, index + config.contextLines);
    for (let context = start; context <= end && selected.size < config.maxOutputLines; context += 1) {
      selected.add(context);
    }
  }
  return selected;
}
function renderSelected(lines2, selected) {
  const body = [];
  const sorted = [...selected].sort((left, right) => left - right);
  let previous = -1;
  let omitted = 0;
  for (const index of sorted) {
    if (index > previous + 1) {
      const start = previous + 2;
      const end = index;
      omitted += index - previous - 1;
      body.push(`[\u2026 original lines ${start}\u2013${end} omitted \u2026]`);
    }
    body.push(lines2[index]);
    previous = index;
  }
  if (previous < lines2.length - 1) {
    omitted += lines2.length - previous - 1;
    body.push(`[\u2026 original lines ${previous + 2}\u2013${lines2.length} omitted \u2026]`);
  }
  return { body, omitted };
}
function collapseAdjacent(lines2) {
  const body = [];
  let omitted = 0;
  for (let index = 0; index < lines2.length; ) {
    const line = lines2[index];
    let end = index + 1;
    while (end < lines2.length && lines2[end] === line) end += 1;
    body.push(line);
    if (end - index > 1) {
      body.push(`[previous line repeated ${end - index - 1} times]`);
      omitted += end - index - 1;
    }
    index = end;
  }
  return { body, omitted };
}
function parseSearchMatch(line) {
  const match = /^(.*):(\d+)(?::\d+)?:(.*)$/.exec(line);
  if (!match || !match[1]) return void 0;
  return { file: match[1], line };
}
function renderSearch(lines2, config) {
  const nonEmpty = lines2.filter((line) => line.trim().length > 0);
  const parsed = nonEmpty.map(parseSearchMatch);
  if (nonEmpty.length === 0 || parsed.filter(Boolean).length < nonEmpty.length / 2) return void 0;
  const groups = /* @__PURE__ */ new Map();
  const unparsed = [];
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
  let omitted = Math.max(0, lines2.length - nonEmpty.length);
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
function result(input, text, compacted, omittedLines) {
  return {
    text,
    compacted,
    originalLines: lineCount(input),
    originalBytes: Buffer.byteLength(input),
    returnedLines: lineCount(text),
    returnedBytes: Buffer.byteLength(text),
    omittedLines
  };
}
function compactText(input, kind, config) {
  const originalLines = lineCount(input);
  const hasLongLine = input.split(/\r\n|\r|\n/).some((line) => Array.from(line).length > config.maxLineLength);
  if (!config.enabledTools.includes(kind) || originalLines <= config.maxOutputLines && Buffer.byteLength(input) <= config.maxOutputBytes && !hasLongLine) {
    return result(input, input, false, 0);
  }
  const lines2 = normalizedLines(input, config);
  if (kind === "search") {
    const search = renderSearch(lines2, config);
    if (search) return result(input, search.body.join("\n"), true, search.omitted);
  }
  const rendered = renderSelected(lines2, selectedIndexes(lines2, kind, config));
  const collapsed = kind === "search" ? rendered : collapseAdjacent(rendered.body);
  return result(
    input,
    collapsed.body.join("\n"),
    true,
    Math.max(0, rendered.omitted + collapsed.omitted)
  );
}
async function compactOutput(options) {
  const compacted = compactText(options.input, options.kind, options.config);
  if (!compacted.compacted) return compacted;
  const store = options.store ?? new ArtifactStore(options.config);
  const artifactId = await store.save(options.input, options.sessionId);
  const header = `[token-saver] ${options.kind}: ${compacted.originalLines} lines/${compacted.originalBytes} B \u2192 ${compacted.returnedLines} lines/${compacted.returnedBytes} B. Full output: ${artifactId}; use token-saver output_slice with startLine and maxLines.`;
  const text = `${header}
${compacted.text}`;
  return {
    ...compacted,
    text,
    artifactId,
    returnedLines: lineCount(text),
    returnedBytes: Buffer.byteLength(text)
  };
}
function detectToolKind(toolName, toolInput) {
  const normalizedName = toolName.toLowerCase();
  if (normalizedName.includes("grep") || normalizedName.includes("search")) return "search";
  if (normalizedName.includes("read")) return "read";
  if (typeof toolInput === "object" && toolInput !== null && "command" in toolInput) {
    const command = toolInput.command;
    if (typeof command === "string" && testCommand.test(command)) return "test";
  }
  return "shell";
}

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
function integer(value, fallback, min, max) {
  if (value === void 0) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function resolveConfig(overrides = {}) {
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
    maxFileBytes: overrides.maxFileBytes ?? defaultConfig.maxFileBytes
  };
}
function configFromEnv(env = process.env) {
  const enabledTools = env.TOKEN_SAVER_TOOLS?.split(",").map((value) => value.trim()).filter((value) => toolKinds.includes(value));
  return resolveConfig({
    enabledTools,
    maxOutputLines: integer(env.TOKEN_SAVER_MAX_LINES, defaultConfig.maxOutputLines, 10, 2e3),
    maxOutputBytes: integer(env.TOKEN_SAVER_MAX_BYTES, defaultConfig.maxOutputBytes, 1e3, 2e6),
    maxLineLength: integer(env.TOKEN_SAVER_MAX_LINE_LENGTH, defaultConfig.maxLineLength, 80, 1e4),
    headLines: integer(env.TOKEN_SAVER_HEAD_LINES, defaultConfig.headLines, 0, 500),
    tailLines: integer(env.TOKEN_SAVER_TAIL_LINES, defaultConfig.tailLines, 0, 500),
    searchPerFile: integer(env.TOKEN_SAVER_SEARCH_PER_FILE, defaultConfig.searchPerFile, 1, 100),
    retentionHours: integer(env.TOKEN_SAVER_RETENTION_HOURS, defaultConfig.retentionHours, 1, 720)
  });
}

// packages/claude/src/handler.ts
function textParts(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return void 0;
  const parts = value.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part === "object" && part !== null && "text" in part) {
      const text = part.text;
      return typeof text === "string" ? text : "";
    }
    return "";
  }).filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : void 0;
}
function extractToolOutput(response) {
  const direct = textParts(response);
  if (direct !== void 0) return direct;
  if (typeof response !== "object" || response === null) return String(response ?? "");
  const record = response;
  for (const key of ["content", "output", "text"]) {
    const value = textParts(record[key]);
    if (value !== void 0) return value;
  }
  if (typeof record.stdout === "string" || typeof record.stderr === "string") {
    return [record.stdout, record.stderr].filter((value) => typeof value === "string").join("\n");
  }
  return JSON.stringify(response);
}
function metadataSuffix(response) {
  if (typeof response !== "object" || response === null) return "";
  const record = response;
  const exitCode = record.exit_code ?? record.exitCode;
  const error = record.is_error === true || record.isError === true;
  const suffix = [];
  if (typeof exitCode === "number" || typeof exitCode === "string") suffix.push(`exit code: ${exitCode}`);
  if (error) suffix.push("tool error: true");
  return suffix.length > 0 ? `
[${suffix.join("; ")}]` : "";
}
async function handlePostToolUse(payload, config = configFromEnv(), store) {
  if (!payload.tool_name) return void 0;
  const kind = detectToolKind(payload.tool_name, payload.tool_input);
  if (kind === "read" && typeof payload.tool_input === "object" && payload.tool_input !== null && ("offset" in payload.tool_input || "limit" in payload.tool_input)) {
    return void 0;
  }
  const result2 = await compactOutput({
    input: extractToolOutput(payload.tool_response),
    kind,
    sessionId: payload.session_id ?? "claude",
    config,
    store
  });
  if (!result2.compacted) return void 0;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: `${result2.text}${metadataSuffix(payload.tool_response)}`
    }
  };
}

// packages/claude/src/post-tool-use.ts
try {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const output = await handlePostToolUse(JSON.parse(input));
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  if (process.env.TOKEN_SAVER_DEBUG === "1") {
    process.stderr.write(`token-saver: ${error instanceof Error ? error.message : String(error)}
`);
  }
}
