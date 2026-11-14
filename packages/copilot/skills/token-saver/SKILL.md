---
name: token-saver
description: Retrieve exact lines from token-saver compacted output instead of rerunning commands, and read large files in bounded windows. Use when a result shows a [token-saver] marker or artifact ID, when about to rerun a command just to see earlier output, when reading a large file, or when asked about token savings.
---

# Token Saver

Results marked `[token-saver]` arrive already compacted; the header names the artifact ID.

- Call `output_slice` with `maxLines` 40-50 and never omit it (the default returns 200 lines). Continue by advancing `startLine` to the end of the returned range; do not widen the window. Never retrieve more of an artifact than you will use.
- Do not rerun a verbose command solely to recover output already stored in an artifact. A `[token-saver] duplicate:` result repeats an earlier output; trust its preview, and slice the referenced artifactId if a specific line matters.
- Do not read large files end-to-end. Use `view` with a bounded range or `compact_read` with `startLine` in 100-200-line windows; fetch the next window only if needed. Never edit based on a compacted preview; fetch the exact region you will modify first.
- After a fix, rerun the narrowest failing command, not the whole suite. To report savings, call `stats` and present figures as estimates.