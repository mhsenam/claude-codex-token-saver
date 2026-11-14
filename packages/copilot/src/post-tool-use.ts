import { handleCopilotPostToolUse } from "./handler.js";

try {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const output = await handleCopilotPostToolUse(JSON.parse(input));
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  if (process.env.TOKEN_SAVER_DEBUG === "1") {
    process.stderr.write(`token-saver: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}