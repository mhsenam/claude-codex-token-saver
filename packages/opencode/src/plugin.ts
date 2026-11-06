import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  ArtifactStore,
  compactOutput,
  configFromEnv,
  detectToolKind,
  preCompactInstructions,
} from "../../core/src/index.js";

type PluginHooks = Awaited<ReturnType<Plugin>>;

const compactableTools = new Set(["bash", "read", "grep"]);

export const TokenSaverPlugin: Plugin = async () => {
  const config = configFromEnv();
  const store = new ArtifactStore(config);

  const outputSlice = {
    description:
      "Retrieve lines from full tool output stored by token-saver compaction. Use the artifactId from a [token-saver] header with startLine/maxLines to inspect omitted content without rerunning the command.",
    args: {
      artifactId: z.string().describe("Artifact ID from the [token-saver] header, e.g. session.<uuid>"),
      startLine: z.number().int().min(1).optional().describe("First line to return (1-based, default 1)"),
      maxLines: z.number().int().min(1).max(1000).optional().describe("Maximum lines to return (default 200)"),
    },
    execute: async (args: { artifactId: string; startLine?: number; maxLines?: number }) => {
      try {
        const slice = await store.readSlice(args.artifactId, args.startLine ?? 1, args.maxLines ?? 200);
        return `[${slice.artifactId}: lines ${slice.startLine}-${slice.endLine} of ${slice.totalLines}]\n${slice.text}`;
      } catch (error) {
        return `token-saver error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };

  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (!compactableTools.has(input.tool)) return;
        const kind = detectToolKind(input.tool, input.args);
        const args = input.args;
        if (
          kind === "read" &&
          typeof args === "object" &&
          args !== null &&
          ("offset" in args || "limit" in args)
        ) {
          return;
        }
        const text = output.output;
        if (typeof text !== "string" || text.length === 0) return;
        const result = await compactOutput({
          input: text,
          kind,
          sessionId: input.sessionID || "opencode",
          config,
          store,
        });
        if (result.compacted) output.output = result.text;
      } catch (error) {
        if (process.env.TOKEN_SAVER_DEBUG === "1") {
          process.stderr.write(`token-saver: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    },
    "experimental.session.compacting": async (_input, output) => {
      if (Array.isArray(output.context) && !output.context.includes(preCompactInstructions)) {
        output.context.push(preCompactInstructions);
      }
    },
    // @opencode-ai/plugin types custom-tool args against its own zod copy, which is
    // structurally incompatible with the workspace zod bundled here; opencode
    // validates against the runtime objects, so only that declaration is bypassed.
    tool: { output_slice: outputSlice } as unknown as NonNullable<PluginHooks["tool"]>,
  };
};

export default TokenSaverPlugin;
