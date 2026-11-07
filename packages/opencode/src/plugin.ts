import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  ArtifactStore,
  buildPreCompactInstructions,
  compactOutput,
  configFromEnv,
  detectToolKind,
  formatStatsSummary,
  isVerboseCommand,
  recordStats,
  rewriteVerboseCommand,
  summarizeStats,
} from "../../core/src/index.js";
import {
  artifactExistsFactory,
  evictMessages,
  evictionOptionsFromEnv,
  recordEvictFactory,
} from "./eviction.js";

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

  const stats = {
    description:
      "Show token-saver statistics: compactions, duplicates avoided, retrievals, and estimated token reduction for stored sessions.",
    args: {},
    execute: async () => {
      try {
        return formatStatsSummary(await summarizeStats(store.root));
      } catch (error) {
        return `token-saver error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };

  return {
    "tool.execute.before": async (input, output) => {
      try {
        if (input.tool !== "bash" || !config.rewriteCommands) return;
        const args = output.args;
        const command = typeof args?.command === "string" ? args.command : undefined;
        if (!command || !isVerboseCommand(command)) return;
        const sessionId = input.sessionID || "opencode";
        const reserved = await store.reserve(sessionId);
        output.args = {
          ...args,
          command: rewriteVerboseCommand({
            command,
            // POSIX shells choke on backslash paths; forward slashes work everywhere.
            filePath: reserved.filePath.replaceAll("\\", "/"),
            artifactId: reserved.artifactId,
            tailLines: Math.max(20, config.maxOutputLines - 2),
          }),
        };
        await recordStats(store.root, {
          type: "rewrite",
          session: sessionId,
          kind: detectToolKind("bash", { command }),
          commandBytes: Buffer.byteLength(command),
        });
      } catch (error) {
        if (process.env.TOKEN_SAVER_DEBUG === "1") {
          process.stderr.write(`token-saver: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    },
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
    "experimental.session.compacting": async (input, output) => {
      const instructions = await buildPreCompactInstructions({
        sessionId: input?.sessionID || "opencode",
        root: store.root,
      });
      if (Array.isArray(output.context) && !output.context.includes(instructions)) {
        output.context.push(instructions);
      }
    },
    // Evict artifact-backed tool results older than a few turns from the
    // outgoing request; full output stays recoverable via output_slice.
    "experimental.chat.messages.transform": async (_input, output) => {
      const options = evictionOptionsFromEnv();
      if (!options) return;
      try {
        await evictMessages(output.messages, options, {
          artifactExists: artifactExistsFactory(store.root),
          recordEvict: recordEvictFactory(store.root),
        });
      } catch (error) {
        if (process.env.TOKEN_SAVER_DEBUG === "1") {
          process.stderr.write(`token-saver: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    },
    // @opencode-ai/plugin types custom-tool args against its own zod copy, which is
    // structurally incompatible with the workspace zod bundled here; opencode
    // validates against the runtime objects, so only that declaration is bypassed.
    tool: { output_slice: outputSlice, stats } as unknown as NonNullable<PluginHooks["tool"]>,
  };
};

export default TokenSaverPlugin;
