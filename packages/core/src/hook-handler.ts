import { ArtifactStore } from "./artifact-store.js";
import { compactOutput, detectToolKind } from "./compact.js";
import { configFromEnv } from "./config.js";
import type { CompactionConfig } from "./types.js";

export interface PostToolUsePayload {
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
}

export type ClaudePostToolUse = PostToolUsePayload;

function textParts(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "object" && part !== null && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function extractToolOutput(response: unknown): string {
  const direct = textParts(response);
  if (direct !== undefined) return direct;
  if (typeof response !== "object" || response === null) return String(response ?? "");

  const record = response as Record<string, unknown>;
  for (const key of ["content", "output", "text"]) {
    const value = textParts(record[key]);
    if (value !== undefined) return value;
  }
  if (typeof record.stdout === "string" || typeof record.stderr === "string") {
    return [record.stdout, record.stderr].filter((value) => typeof value === "string").join("\n");
  }
  return JSON.stringify(response);
}

function metadataSuffix(response: unknown): string {
  if (typeof response !== "object" || response === null) return "";
  const record = response as Record<string, unknown>;
  const exitCode = record.exit_code ?? record.exitCode;
  const error = record.is_error === true || record.isError === true;
  const suffix = [];
  if (typeof exitCode === "number" || typeof exitCode === "string") suffix.push(`exit code: ${exitCode}`);
  if (error) suffix.push("tool error: true");
  return suffix.length > 0 ? `\n[${suffix.join("; ")}]` : "";
}

export async function handlePostToolUse(
  payload: PostToolUsePayload,
  config: CompactionConfig = configFromEnv(),
  store?: ArtifactStore,
  defaultSession = "claude",
): Promise<Record<string, unknown> | undefined> {
  if (!payload.tool_name) return undefined;
  const kind = detectToolKind(payload.tool_name, payload.tool_input);
  if (
    kind === "read" &&
    typeof payload.tool_input === "object" &&
    payload.tool_input !== null &&
    ("offset" in payload.tool_input || "limit" in payload.tool_input)
  ) {
    return undefined;
  }

  const result = await compactOutput({
    input: extractToolOutput(payload.tool_response),
    kind,
    sessionId: payload.session_id ?? defaultSession,
    config,
    store,
  });
  if (!result.compacted) return undefined;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: `${result.text}${metadataSuffix(payload.tool_response)}`,
    },
  };
}
