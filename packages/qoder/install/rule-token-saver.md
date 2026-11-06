TokenSaver is installed. Follow these rules for all shell commands, searches, and file reads:

- When a result contains `[token-saver]`, use the compacted content first and keep its artifact ID and exit code available for later reasoning.
- To inspect omitted lines, call the token-saver `output_slice` tool with the artifact ID and a small `startLine`/`maxLines` range instead of rerunning the command.
- For operations expected to produce more than about 100 lines of output, prefer the token-saver MCP tools: `compact_run` for shell commands, `compact_search` for repository searches, and `compact_read` for large files where an exact range is not required.
- Use built-in tools for small outputs, exact edits, and precise file ranges.
