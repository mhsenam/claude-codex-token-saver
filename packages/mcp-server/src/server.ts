import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArtifactStore, configFromEnv } from "../../core/src/index.js";
import { compactRead, compactRun, compactSearch, outputSlice, statsSummary } from "./tools.js";

const config = configFromEnv();
const store = new ArtifactStore(config);
const server = new McpServer({ name: "token-saver", version: "0.5.0" });

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  };
}

server.registerTool(
  "compact_read",
  {
    title: "Compact file read",
    description: "Read a project file with deterministic compaction for large content. Use startLine for an exact, uncompacted range.",
    inputSchema: {
      filePath: z.string().min(1).describe("Project-relative file path"),
      startLine: z.number().int().min(1).optional(),
      maxLines: z.number().int().min(1).max(1000).optional(),
    },
  },
  async ({ filePath, startLine, maxLines }) => {
    try {
      return text(await compactRead({ filePath, startLine, maxLines, config, store }));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "compact_search",
  {
    title: "Compact repository search",
    description: "Search with ripgrep and group large result sets by file while retaining full output in a local artifact.",
    inputSchema: {
      pattern: z.string().min(1),
      paths: z.array(z.string()).max(20).optional(),
      glob: z.string().optional(),
    },
  },
  async ({ pattern, paths, glob }) => {
    try {
      return text(await compactSearch({ pattern, paths, glob, config, store }));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "compact_run",
  {
    title: "Compact command output",
    description: "Run a project shell command and compact verbose output. The command and exit code are preserved; full output is recoverable.",
    inputSchema: {
      command: z.string().min(1),
      cwd: z.string().optional().describe("Project-relative working directory"),
      timeoutMs: z.number().int().min(1000).max(600000).optional(),
    },
  },
  async ({ command, cwd, timeoutMs }) => {
    try {
      return text(await compactRun({ command, cwd, timeoutMs, config, store }));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "output_slice",
  {
    title: "Retrieve full output slice",
    description: "Retrieve exact lines from a full-output artifact produced by token-saver.",
    inputSchema: {
      artifactId: z.string().min(1),
      startLine: z.number().int().min(1).optional(),
      maxLines: z.number().int().min(1).max(1000).optional(),
    },
  },
  async ({ artifactId, startLine, maxLines }) => {
    try {
      return text(await outputSlice({ artifactId, startLine, maxLines, store }));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "stats",
  {
    title: "Token-saver statistics",
    description: "Show token-saver statistics: compactions, duplicates avoided, retrievals, and estimated token reduction across stored sessions.",
    inputSchema: {},
  },
  async () => {
    try {
      return text(await statsSummary({ store }));
    } catch (error) {
      return failure(error);
    }
  },
);

await server.connect(new StdioServerTransport());
