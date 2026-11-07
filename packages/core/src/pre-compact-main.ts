import { buildPreCompactInstructions, preCompactInstructions } from "./pre-compact.js";

/**
 * PreCompact hook entry point. The host pipes a JSON payload (session_id,
 * trigger, ...) to stdin. Everything fails open: with no readable payload the
 * static base instructions are printed, exactly like earlier versions.
 */
async function readStdinPayload(): Promise<string> {
  if (!process.stdin.readable) return "";
  const chunks: Buffer[] = [];
  const collect = (async () => {
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
      if (chunks.reduce((sum, part) => sum + part.length, 0) > 1_000_000) break;
    }
    return Buffer.concat(chunks).toString("utf8");
  })();
  const timeout = new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(""), 1_500);
    timer.unref();
  });
  return Promise.race([collect, timeout]);
}

async function main(): Promise<void> {
  let instructions = preCompactInstructions;
  try {
    const payload = await readStdinPayload();
    if (payload) {
      const parsed = JSON.parse(payload) as { session_id?: unknown };
      const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : undefined;
      instructions = await buildPreCompactInstructions({ sessionId });
    }
  } catch {
    instructions = preCompactInstructions;
  }
  process.stdout.write(instructions);
}

await main();
