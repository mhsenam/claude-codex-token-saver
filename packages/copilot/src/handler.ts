import { configFromEnv, handlePostToolUse } from "../../core/src/index.js";
import type { ArtifactStore, CompactionConfig } from "../../core/src/index.js";

export interface CopilotPostToolUse {
  sessionId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: { resultType?: string; textResultForLlm?: string };
}

const TOOL_NAME_ALIASES: Record<string, string> = { view: "Read" };

export async function handleCopilotPostToolUse(
  payload: CopilotPostToolUse,
  config: CompactionConfig = configFromEnv(),
  store?: ArtifactStore,
): Promise<Record<string, unknown> | undefined> {
  const text = payload.toolResult?.textResultForLlm;
  if (!payload.toolName || typeof text !== "string") return undefined;
  const result = await handlePostToolUse(
    {
      session_id: payload.sessionId,
      tool_name: TOOL_NAME_ALIASES[payload.toolName] ?? payload.toolName,
      tool_input: payload.toolArgs,
      tool_response: text,
    },
    config,
    store,
    "copilot",
  );
  if (!result) return undefined;
  const updated = (result.hookSpecificOutput as { updatedToolOutput?: unknown }).updatedToolOutput;
  if (typeof updated !== "string") return undefined;
  return { modifiedResult: { resultType: "success", textResultForLlm: updated } };
}