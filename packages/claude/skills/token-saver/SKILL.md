---
name: token-saver
description: Recover full tool output compacted by token-saver. Use when a result contains a token-saver artifact ID or omitted lines, or when asked about token usage and savings.
---

# Token Saver

When a result contains `[token-saver]`, use the compacted content first. Call the `token-saver` MCP server's `output_slice` tool with its `artifactId` only when omitted details are needed.

A result marked `[token-saver] duplicate:` is an exact repeat of an earlier output; its preview plus the referenced artifact covers everything, so do not request the content again unless a specific line range matters.

Request a small `startLine`/`maxLines` range, then continue from the returned line number if necessary. Do not rerun a verbose command solely to recover output that is already stored in an artifact. To report how much context token-saver has saved, call the `stats` tool.
