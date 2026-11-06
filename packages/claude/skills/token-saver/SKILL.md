---
name: token-saver
description: Recover full tool output compacted by token-saver. Use when a result contains a token-saver artifact ID or omitted lines.
---

# Token Saver

When a result contains `[token-saver]`, use the compacted content first. Call the `token-saver` MCP server's `output_slice` tool with its `artifactId` only when omitted details are needed.

Request a small `startLine`/`maxLines` range, then continue from the returned line number if necessary. Do not rerun a verbose command solely to recover output that is already stored in an artifact.
