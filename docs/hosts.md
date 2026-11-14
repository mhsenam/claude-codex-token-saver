# Installing TokenSaver on other hosts

TokenSaver ships native adapters for Claude Code, Codex CLI, opencode, Qoder,
and GitHub Copilot CLI (see the [README](../README.md) quick starts). Any other
MCP-capable host can run TokenSaver through the universal MCP server plus a
skill wrapper.

**Long-tail hosts get on-demand compaction only.** There are no automatic hooks
and no history eviction on these hosts: the agent must call `compact_run`,
`compact_search`, or `compact_read` itself, and retrieve omitted lines with
`output_slice`. The bundled skill teaches the agent when to choose those tools
and how to retrieve bounded windows. Nothing rewrites the host's own tool
output, and nothing evicts old results from history.

## Universal install (any MCP host)

Requires **Node.js 22 or newer**.

Register the MCP server in your host's MCP config:

```json
{
  "mcpServers": {
    "token-saver": { "command": "npx", "args": ["-y", "token-saver-mcp"] }
  }
}
```

This runs the published `token-saver-mcp` bin through `npx` — no clone or
build step. It exposes `compact_read`, `compact_search`, `compact_run`,
`output_slice`, and `stats`.

Then place the matching skill wrapper from `release/skills/` (produced by
`npm run package`) at the host's skill/rules location — see the per-host
table below. The wrapper body is identical across hosts; only the
frontmatter and placement differ.

### Fallbacks

- **Pinned version.** If `npx` resolves an unexpected version, pin it:
  `npx -y token-saver-mcp@0.5.0`.
- **Offline / local path.** Point the MCP `command` at `node` and the built
  bundle instead of `npx`. Run `npm run build` first; the bundle at
  `packages/mcp-server/dist/mcp-server.js` is self-contained (it carries a
  `#!/usr/bin/env node` shebang and is the published bin):

  ```json
  {
    "mcpServers": {
      "token-saver": {
        "command": "node",
        "args": ["/absolute/path/to/token-saver/packages/mcp-server/dist/mcp-server.js"]
      }
    }
  }
  ```

## Per-host setup

| Host | MCP config location | Skill placement | Wrapper from `release/skills/` |
| --- | --- | --- | --- |
| Cursor | `.cursor/mcp.json` | `.cursor/rules/token-saver.mdc` | `cursor/token-saver.mdc` |
| Cline | `cline_mcp_settings.json` | `.clinerules/token-saver.md` | `cline/token-saver.md` |
| Zoo Code (Roo successor) | `.roo/mcp.json` | `.roo/rules/token-saver.md` | `agents/AGENTS.md` (generic) |
| Goose | Goose MCP config | `.goosehints` | `goose/.goosehints` |
| Windsurf/Devin | `.devin/mcp_config.json` | `.devin/rules/token-saver.md` or `AGENTS.md` | `agents/AGENTS.md` (generic) |
| Zed | `context_servers` in `settings.json` | `.rules` | `zed/token-saver.rules` |
| Factory | `mcp.json` | `AGENTS.md` | `agents/AGENTS.md` (generic) |
| Antigravity | `mcp_config.json` | `.agents/skills/token-saver/SKILL.md` | `antigravity/token-saver/SKILL.md` |

Zoo Code, Windsurf/Devin, and Factory have no dedicated wrapper: they reuse the
generic `agents/AGENTS.md` body. Save that body under the host's rules filename
(for example `.roo/rules/token-saver.md` for Zoo Code). The emitter never forks
the body text, so the guidance is identical to the dedicated wrappers.

Notes:

- **Zed** reads MCP servers from `context_servers` in `settings.json`, not
  `mcpServers`. Register the same command there:

  ```json
  {
    "context_servers": {
      "token-saver": {
        "command": { "path": "npx", "args": ["-y", "token-saver-mcp"] }
      }
    }
  }
  ```

- **Antigravity** uses the full canonical skill (frontmatter + body). Copy
  `release/skills/antigravity/token-saver/SKILL.md` to
  `.agents/skills/token-saver/SKILL.md`.
- **Goose** uses the body-only `.goosehints` wrapper at the project root.

## GitHub Copilot CLI (native adapter)

Unlike the long-tail hosts, Copilot CLI gets **automatic** compaction through a
native `postToolUse` hook, plus MCP retrieval tools.

- Hook: `packages/copilot/hooks/hooks.json` — matcher `bash|powershell|grep|glob|view`,
  running the `post-tool-use.sh` (bash) / `post-tool-use.ps1` (PowerShell)
  wrappers.
- Copilot's `view` read tool is aliased to `Read`, so read compaction stays
  opt-in (off by default), exactly like the other hosts. Enable it with
  `TOKEN_SAVER_TOOLS=shell,test,search,read`.
- MCP tools come from `packages/copilot/.mcp.json`, which registers
  `npx -y token-saver-mcp`.
- Bundled skill: `packages/copilot/skills/token-saver/SKILL.md`.

### Manual setup

1. Build the adapter (or use the tracked bundle): `npm run build` produces
   `packages/copilot/dist/post-tool-use.js`.
2. Install the hook. Copilot CLI loads hooks from `.github/hooks/*.json`
   (project) or `~/.copilot/hooks/*.json` (user;
   `%USERPROFILE%\.copilot\hooks\` on Windows). Copy `hooks.json` there as
   `token-saver.json`, keep `post-tool-use.sh` / `post-tool-use.ps1` beside it,
   and place the built `dist/` folder as a sibling of the hooks directory so the
   wrappers' `../dist/post-tool-use.js` path resolves (the same layout as
   `packages/copilot/`).
3. Register the MCP server: in Copilot CLI run `/mcp add`, name the server
   `token-saver`, choose a local (stdio) server, command `npx`, args
   `-y token-saver-mcp`. The bundled `packages/copilot/.mcp.json` shows the
   equivalent config.
4. Optional — install the bundled skill: copy
   `packages/copilot/skills/token-saver/` to `.github/skills/token-saver/`
   (project) or `~/.copilot/skills/token-saver/` (personal).
5. Restart Copilot CLI; hooks load at startup.

The hook fails open: any parse or compaction error passes the original output
through. Set `TOKEN_SAVER_DEBUG=1` for stderr diagnostics.

## Platform notes

- **Gemini CLI is sunset** (June 18, 2026) in favor of **Antigravity CLI**. Use
  the Antigravity row above; there is no native Gemini adapter.
- **Roo Code shut down** (May 2026). Its community fork **Zoo Code** is covered
  by the universal MCP + skill layer (it has no hooks yet).
- **Aider is not supported**: it has no MCP client and no hooks, so TokenSaver
  cannot integrate with it.
