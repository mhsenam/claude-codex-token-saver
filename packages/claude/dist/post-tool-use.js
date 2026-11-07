// packages/core/src/artifact-store.ts
import { createHash, randomUUID } from "node:crypto";
import { promises as fs2 } from "node:fs";
import os from "node:os";
import path2 from "node:path";

// packages/core/src/stats.ts
import { promises as fs } from "node:fs";
import path from "node:path";
var statsFileName = "stats.jsonl";
function statsFilePath(root) {
  return path.join(root, statsFileName);
}
function statsEnabled() {
  return process.env.TOKEN_SAVER_STATS !== "0";
}
async function recordStats(root, event) {
  if (!statsEnabled()) return;
  try {
    const recorded = { ...event, ts: Date.now() };
    await fs.appendFile(statsFilePath(root), `${JSON.stringify(recorded)}
`, { encoding: "utf8" });
  } catch {
  }
}

// packages/core/src/artifact-store.ts
var artifactPattern = /^([a-zA-Z0-9_-]{1,64})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
function sessionKey(sessionId) {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) return sessionId;
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}
function sessionDirectory(root, sessionId) {
  return path2.join(root, sessionKey(sessionId));
}
function lines(text) {
  return text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
}
var ArtifactStore = class {
  root;
  retentionHours;
  lastCleanup = 0;
  constructor(config, root) {
    this.root = root ?? process.env.TOKEN_SAVER_DATA_DIR ?? path2.join(os.homedir(), ".token-saver", "outputs");
    this.retentionHours = config.retentionHours;
  }
  async save(output, sessionId = "default") {
    const session = sessionKey(sessionId);
    const id = randomUUID();
    const directory = path2.join(this.root, session);
    await fs2.mkdir(directory, { recursive: true, mode: 448 });
    await fs2.writeFile(path2.join(directory, `${id}.log`), output, { encoding: "utf8", mode: 384, flag: "wx" });
    await this.cleanupExpired();
    return `${session}.${id}`;
  }
  async reserve(sessionId = "default") {
    const session = sessionKey(sessionId);
    const id = randomUUID();
    const directory = path2.join(this.root, session);
    await fs2.mkdir(directory, { recursive: true, mode: 448 });
    return { artifactId: `${session}.${id}`, filePath: path2.join(directory, `${id}.log`) };
  }
  async readSlice(artifactId, startLine = 1, maxLines = 200) {
    const match = artifactPattern.exec(artifactId);
    if (!match) throw new Error("Invalid token-saver artifact ID");
    if (!Number.isInteger(startLine) || startLine < 1) throw new Error("startLine must be a positive integer");
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 1e3) {
      throw new Error("maxLines must be between 1 and 1000");
    }
    const filePath = path2.join(this.root, match[1], `${match[2]}.log`);
    const output = await fs2.readFile(filePath, "utf8");
    const allLines = lines(output);
    const start = Math.min(startLine - 1, allLines.length);
    const selected = allLines.slice(start, start + maxLines);
    const endLine = selected.length === 0 ? start : start + selected.length;
    await recordStats(this.root, { type: "retrieve", session: match[1], artifactId, startLine, maxLines });
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
      sessions = await fs2.readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const session of sessions) {
      if (!session.isDirectory() || !/^[a-zA-Z0-9_-]{1,64}$/.test(session.name)) continue;
      const directory = path2.join(this.root, session.name);
      const files = await fs2.readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/^[0-9a-f-]{36}\.log$/.test(file.name)) continue;
        const filePath = path2.join(directory, file.name);
        const stat = await fs2.stat(filePath);
        if (stat.mtimeMs < cutoff) await fs2.rm(filePath);
      }
      const remaining = await fs2.readdir(directory);
      if (remaining.length === 0) await fs2.rmdir(directory);
    }
  }
};

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
  rewriteCommands: true,
  policyBudgets: {}
};
function integer(value, fallback, min, max) {
  if (value === void 0) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function flag(value, fallback) {
  if (value === void 0) return fallback;
  if (value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  return fallback;
}
function policyConfig(config, kind) {
  const override = config.policyBudgets[kind];
  if (!override) return config;
  return {
    ...config,
    maxOutputLines: override.maxOutputLines ?? config.maxOutputLines,
    maxOutputBytes: override.maxOutputBytes ?? config.maxOutputBytes,
    headLines: override.headLines ?? config.headLines,
    tailLines: override.tailLines ?? config.tailLines
  };
}
function resolveConfig(overrides = {}) {
  const enabledTools = overrides.enabledTools?.filter((kind) => toolKinds.includes(kind));
  const policyBudgets = {};
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
    policyBudgets
  };
}
function policyBudgetsFromEnv(env) {
  const budgets = {};
  for (const kind of toolKinds) {
    const suffix = kind.toUpperCase();
    const override = {};
    const maxOutputLines = integer(env[`TOKEN_SAVER_MAX_LINES_${suffix}`], 0, 10, 2e3);
    if (maxOutputLines > 0) override.maxOutputLines = maxOutputLines;
    const maxOutputBytes = integer(env[`TOKEN_SAVER_MAX_BYTES_${suffix}`], 0, 1e3, 2e6);
    if (maxOutputBytes > 0) override.maxOutputBytes = maxOutputBytes;
    const headLines = integer(env[`TOKEN_SAVER_HEAD_LINES_${suffix}`], -1, 0, 500);
    if (headLines >= 0) override.headLines = headLines;
    const tailLines = integer(env[`TOKEN_SAVER_TAIL_LINES_${suffix}`], -1, 0, 500);
    if (tailLines >= 0) override.tailLines = tailLines;
    if (Object.keys(override).length > 0) budgets[kind] = override;
  }
  return budgets;
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
    retentionHours: integer(env.TOKEN_SAVER_RETENTION_HOURS, defaultConfig.retentionHours, 1, 720),
    dedup: flag(env.TOKEN_SAVER_DEDUP, defaultConfig.dedup),
    dedupPreviewLines: integer(env.TOKEN_SAVER_DEDUP_PREVIEW_LINES, defaultConfig.dedupPreviewLines, 1, 200),
    policyBudgets: policyBudgetsFromEnv(env),
    // The rewrite template is POSIX sh; on Windows the host shell may not be bash,
    // so rewriting stays opt-in there until TOKEN_SAVER_REWRITE=1 is set explicitly.
    rewriteCommands: flag(
      env.TOKEN_SAVER_REWRITE,
      defaultConfig.rewriteCommands && process.platform !== "win32"
    )
  });
}

// packages/core/src/dedup.ts
import { createHash as createHash2 } from "node:crypto";
import { promises as fs3 } from "node:fs";
import path3 from "node:path";
var indexFileName = "dedup.json";
function outputHash(input) {
  return createHash2("sha256").update(input).digest("hex").slice(0, 32);
}
var DedupIndex = class {
  filePath;
  retentionHours;
  entries;
  constructor(root, sessionId, retentionHours) {
    this.filePath = path3.join(sessionDirectory(root, sessionId), indexFileName);
    this.retentionHours = retentionHours;
  }
  async lookup(hash) {
    const entries = await this.load();
    const entry = entries[hash];
    if (!entry) return void 0;
    if (Date.now() - entry.ts > this.retentionHours * 60 * 60 * 1e3) return void 0;
    return entry;
  }
  async remember(hash, entry) {
    const entries = await this.load();
    const cutoff = Date.now() - this.retentionHours * 60 * 60 * 1e3;
    for (const key of Object.keys(entries)) {
      if (entries[key].ts < cutoff) delete entries[key];
    }
    entries[hash] = entry;
    try {
      await fs3.writeFile(`${this.filePath}.tmp`, JSON.stringify(entries), { encoding: "utf8", mode: 384 });
      await fs3.rename(`${this.filePath}.tmp`, this.filePath);
    } catch {
    }
  }
  async load() {
    if (this.entries) return this.entries;
    try {
      const raw = await fs3.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.entries = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      this.entries = {};
    }
    return this.entries;
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
  const effective = policyConfig(config, kind);
  const originalLines = lineCount(input);
  const hasLongLine = input.split(/\r\n|\r|\n/).some((line) => Array.from(line).length > effective.maxLineLength);
  if (!effective.enabledTools.includes(kind) || originalLines <= effective.maxOutputLines && Buffer.byteLength(input) <= effective.maxOutputBytes && !hasLongLine) {
    return result(input, input, false, 0);
  }
  const lines2 = normalizedLines(input, effective);
  if (kind === "search") {
    const search = renderSearch(lines2, effective);
    if (search) return result(input, search.body.join("\n"), true, search.omitted);
  }
  const rendered = renderSelected(lines2, selectedIndexes(lines2, kind, effective));
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
  const sessionId = options.sessionId ?? "default";
  if (options.config.dedup) {
    const index = new DedupIndex(store.root, sessionId, options.config.retentionHours);
    const hash = outputHash(options.input);
    const existing = await index.lookup(hash);
    if (existing) {
      const preview = options.input.replace(ansiPattern, "").split(/\r\n|\r|\n/).slice(0, options.config.dedupPreviewLines).join("\n");
      const stub = [
        `[token-saver] duplicate: identical output was already stored (artifactId=${existing.artifactId}, ${existing.lines} lines).`,
        preview,
        "[\u2026 remaining lines are identical to the earlier result; use output_slice to retrieve any line range \u2026]"
      ].join("\n");
      await recordStats(store.root, {
        type: "dedup",
        session: sessionId,
        kind: options.kind,
        originalBytes: compacted.originalBytes,
        returnedBytes: Buffer.byteLength(stub),
        artifactId: existing.artifactId
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
        omittedLines: Math.max(0, compacted.originalLines - options.config.dedupPreviewLines)
      };
    }
  }
  const artifactId = await store.save(options.input, sessionId);
  const header = `[token-saver] ${options.kind}: ${compacted.originalLines} lines/${compacted.originalBytes} B \u2192 ${compacted.returnedLines} lines/${compacted.returnedBytes} B. Full output: ${artifactId}; use token-saver output_slice with startLine and maxLines.`;
  const text = `${header}
${compacted.text}`;
  if (options.config.dedup) {
    const index = new DedupIndex(store.root, sessionId, options.config.retentionHours);
    await index.remember(outputHash(options.input), {
      artifactId,
      bytes: compacted.originalBytes,
      lines: compacted.originalLines,
      ts: Date.now()
    });
  }
  await recordStats(store.root, {
    type: "compact",
    session: sessionId,
    kind: options.kind,
    originalBytes: compacted.originalBytes,
    returnedBytes: Buffer.byteLength(text),
    artifactId
  });
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

// packages/core/src/hook-handler.ts
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
    const stdout = typeof record.stdout === "string" ? record.stdout : "";
    const stderr = typeof record.stderr === "string" ? record.stderr : "";
    if (stdout && stderr) return `${stdout}
--- stderr ---
${stderr}`;
    return stdout || stderr;
  }
  return JSON.stringify(response);
}
function isTextBlocks(value) {
  return Array.isArray(value) && value.every(
    (part) => typeof part === "string" || typeof part === "object" && part !== null && "text" in part
  );
}
function lineCount2(text) {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
}
function reshapeToolOutput(response, text) {
  if (typeof response === "string" || typeof response !== "object" || response === null) return text;
  if (Array.isArray(response)) {
    return isTextBlocks(response) ? [{ type: "text", text }] : text;
  }
  const record = { ...response };
  let replaced = false;
  for (const key of ["content", "output", "text"]) {
    const value = record[key];
    if (typeof value === "string") {
      record[key] = text;
      replaced = true;
      break;
    }
    if (isTextBlocks(value)) {
      record[key] = [{ type: "text", text }];
      replaced = true;
      break;
    }
  }
  if (!replaced && (typeof record.stdout === "string" || typeof record.stderr === "string")) {
    record.stdout = text;
    record.stderr = "";
    replaced = true;
  }
  if (!replaced) return text;
  if (typeof record.numLines === "number") record.numLines = lineCount2(text);
  return record;
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
async function handlePostToolUse(payload, config = configFromEnv(), store, defaultSession = "claude") {
  if (!payload.tool_name) return void 0;
  const kind = detectToolKind(payload.tool_name, payload.tool_input);
  if (kind === "read" && typeof payload.tool_input === "object" && payload.tool_input !== null && ("offset" in payload.tool_input || "limit" in payload.tool_input)) {
    return void 0;
  }
  const result2 = await compactOutput({
    input: extractToolOutput(payload.tool_response),
    kind,
    sessionId: payload.session_id ?? defaultSession,
    config,
    store
  });
  if (!result2.compacted) return void 0;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: reshapeToolOutput(
        payload.tool_response,
        `${result2.text}${metadataSuffix(payload.tool_response)}`
      )
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
