import { configFromEnv, handlePostToolUse } from "../../core/src/index.js";
import type { ArtifactStore } from "../../core/src/index.js";
import type { CompactionConfig, PostToolUsePayload } from "../../core/src/index.js";

export async function handleQoderPostToolUse(
  payload: PostToolUsePayload,
  config: CompactionConfig = configFromEnv(),
  store?: ArtifactStore,
): Promise<Record<string, unknown> | undefined> {
  return handlePostToolUse(payload, config, store, "qoder");
}
