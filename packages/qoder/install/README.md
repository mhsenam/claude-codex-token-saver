# Manual install (fallback)

The preferred install is importing the plugin folder: Qoder IDE, Settings > Plugins > import from a local folder, or `qoder plugins install <path-to-packages/qoder>` followed by a restart.

If plugin import is unavailable or the bundled `.mcp.json` / hook paths do not resolve in your Qoder version, configure the components manually. All paths below refer to this folder (the packaged plugin directory containing `dist/`).

## 1. MCP server

CLI:

```bash
qoder mcp add token-saver -s user -- node "<plugin-dir>/dist/mcp-server.js"
```

IDE: Settings > MCP > My Servers > + Add, then paste:

```json
{
  "mcpServers": {
    "token-saver": {
      "type": "stdio",
      "command": "node",
      "args": ["<plugin-dir>/dist/mcp-server.js"]
    }
  }
}
```

## 2. Hooks

Merge the `hooks` object from `../hooks/hooks.json` into `~/.qoder/settings.json` (user) or `<project>/.qoder/settings.json` (project), replacing `${QODER_PLUGIN_ROOT}` with the actual plugin directory path:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash|Read|Grep|run_in_terminal",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<plugin-dir>/dist/post-tool-use.js\"",
            "timeout": 30
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"<plugin-dir>/dist/pre-compact.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## 3. Optional rule

Qoder plugins do not currently bundle rules. To bias the agent toward the compact tools, create an Always Apply rule in `.qoder/rules/token-saver.md` (project) or as a user rule and paste the contents of `rule-token-saver.md`.

## 4. Restart

Restart Qoder after changing hooks or MCP configuration; hook settings are read at startup.
