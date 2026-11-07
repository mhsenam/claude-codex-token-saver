import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore, resolveConfig } from "../../core/src/index.js";
import {
  artifactExistsFactory,
  evictMessages,
  evictionOptionsFromEnv,
  parseArtifactId,
  placeholder,
  type EvictionDeps,
} from "../src/eviction.js";

const uuid = (hex: string) => `${hex}-5717-4562-b3fc-2c963f66afa6`;
const ID_1 = `sess.${uuid("3fa85f64")}`;
const ID_2 = `sess.${uuid("4fa85f64")}`;
const ID_3 = `sess.${uuid("5fa85f64")}`;
const ID_4 = `sess.${uuid("6fa85f64")}`;
const ALL_IDS = [ID_1, ID_2, ID_3, ID_4];

function compactedOutput(artifactId: string, lines = 1_000): string {
  const body = Array.from({ length: lines }, (_, index) => `log ${index}`).join("\n");
  const header = `[token-saver] test: ${lines + 4} lines/54321 B → 87 lines/5432 B. Full output: ${artifactId}; use token-saver output_slice with startLine and maxLines.`;
  return `${header}\n${body}\n[… original lines omitted …]\nFAIL: one`;
}

function duplicateOutput(artifactId: string): string {
  const preview = Array.from({ length: 160 }, (_, index) => `log ${index}`).join("\n");
  return `[token-saver] duplicate: identical output was already stored (artifactId=${artifactId}, 404 lines).\n${preview}\n[… remaining lines are identical to the earlier result; use output_slice to retrieve any line range …]`;
}

interface Harness extends EvictionDeps {
  evict(messages: { parts?: unknown[] }[], keepRecent?: number, minNetSavings?: number): Promise<{ evicted: number; bytesSaved: number }>;
  events: { session: string; artifactId: string; bytes: number }[];
}

function harness(existing: string[] = ALL_IDS): Harness {
  const events: Harness["events"] = [];
  const deps: EvictionDeps = {
    artifactExists: async (artifactId) => existing.includes(artifactId),
    recordEvict: async (session, artifactId, bytes) => {
      events.push({ session, artifactId, bytes });
    },
  };
  return {
    ...deps,
    events,
    evict(messages, keepRecent = 3, minNetSavings = 6_000) {
      return evictMessages(messages, { keepRecent, minNetSavings }, deps);
    },
  };
}

function toolPart(output: string, sessionID = "s1"): { type: string; sessionID: string; state: { status: string; output: string } } {
  return { type: "tool", sessionID, state: { status: "completed", output } };
}

function stateOf(part: unknown): { output: string } {
  return (part as { state: { output: string } }).state;
}

test("parseArtifactId reads compacted headers and duplicate stubs, rejects the rest", () => {
  assert.equal(parseArtifactId(compactedOutput(ID_1)), ID_1);
  assert.equal(parseArtifactId(duplicateOutput(ID_1)), ID_1);
  assert.equal(parseArtifactId("short"), undefined);
  assert.equal(parseArtifactId("no header here ".repeat(100)), undefined);
  assert.equal(parseArtifactId(undefined), undefined);
});

test("evicts artifact-backed results older than keepRecent and records stats", async () => {
  const h = harness();
  const messages = [
    { parts: [toolPart(compactedOutput(ID_1))] },
    { parts: [toolPart(compactedOutput(ID_2)), toolPart(compactedOutput(ID_3))] },
    { parts: [toolPart(duplicateOutput(ID_1))] },
    { parts: [toolPart(compactedOutput(ID_4))] },
  ];
  // candidates in order: ID_1, ID_2, ID_3, duplicate(ID_1), ID_4 -> keep the last 3
  const result = await h.evict(messages);

  assert.equal(result.evicted, 2);
  assert.ok(result.bytesSaved > 2_000);
  assert.deepEqual(
    h.events.map((event) => event.artifactId),
    [ID_1, ID_2],
  );

  assert.equal(stateOf(messages[0]!.parts![0]).output, placeholder(ID_1));
  assert.equal(stateOf(messages[1]!.parts![0]).output, placeholder(ID_2));

  // the three most recent artifact-backed results stay verbatim
  assert.match(stateOf(messages[1]!.parts![1]).output, /\[token-saver\] test:/);
  assert.match(stateOf(messages[2]!.parts![0]).output, /duplicate: identical output/);
  assert.match(stateOf(messages[3]!.parts![0]).output, /\[token-saver\] test:/);
});

test("keeps non-artifact tool results untouched", async () => {
  const h = harness();
  const plain = toolPart(Array.from({ length: 200 }, (_, index) => `plain ${index}`).join("\n"));
  const messages = [
    { parts: [toolPart(compactedOutput(ID_1))] },
    { parts: [plain] },
    { parts: [toolPart(compactedOutput(ID_2))] },
    { parts: [toolPart(compactedOutput(ID_3))] },
    { parts: [toolPart(compactedOutput(ID_4))] },
  ];
  const result = await h.evict(messages);

  assert.equal(result.evicted, 1);
  assert.deepEqual(h.events.map((event) => event.artifactId), [ID_1]);
  assert.ok(stateOf(plain).output.startsWith("plain 0"));
});

test("skips candidates whose artifact no longer exists", async () => {
  const h = harness([]);
  const messages = [
    { parts: [toolPart(compactedOutput(ID_1))] },
    { parts: [toolPart(compactedOutput(ID_2))] },
    { parts: [toolPart(compactedOutput(ID_3))] },
    { parts: [toolPart(compactedOutput(ID_4))] },
  ];
  const result = await h.evict(messages);
  assert.equal(result.evicted, 0);
  assert.equal(h.events.length, 0);
});

test("rewrites nothing when the batch savings miss the threshold", async () => {
  const h = harness();
  const messages = [
    { parts: [toolPart(compactedOutput(ID_1, 150))] },
    { parts: [toolPart(compactedOutput(ID_2, 150))] },
    { parts: [toolPart(compactedOutput(ID_3, 150))] },
    { parts: [toolPart(compactedOutput(ID_4, 400))] },
  ];
  const result = await h.evict(messages, 3, 6_000);
  assert.equal(result.evicted, 0);
  assert.equal(h.events.length, 0);
});

test("keepRecent 0 evicts every artifact-backed result", async () => {
  const h = harness();
  const messages = [
    { parts: [toolPart(compactedOutput(ID_1))] },
    { parts: [toolPart(compactedOutput(ID_2))] },
  ];
  const result = await h.evict(messages, 0, 1_000);
  assert.equal(result.evicted, 2);
  assert.equal(stateOf(messages[0]!.parts![0]).output, placeholder(ID_1));
  assert.equal(stateOf(messages[1]!.parts![0]).output, placeholder(ID_2));
});

test("evictionOptionsFromEnv parses knobs and honors the kill switch", () => {
  assert.equal(evictionOptionsFromEnv({ TOKEN_SAVER_EVICTION: "0" }), undefined);
  assert.deepEqual(evictionOptionsFromEnv({}), { keepRecent: 3, minNetSavings: 6_000 });
  assert.deepEqual(evictionOptionsFromEnv({ TOKEN_SAVER_EVICTION_KEEP_RECENT: "5", TOKEN_SAVER_EVICTION_MIN_NET_SAVINGS: "10000" }), {
    keepRecent: 5,
    minNetSavings: 10_000,
  });
  assert.deepEqual(evictionOptionsFromEnv({ TOKEN_SAVER_EVICTION_KEEP_RECENT: "nope" }), { keepRecent: 3, minNetSavings: 6_000 });
});

test("artifactExistsFactory checks the real artifact store layout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-saver-evict-fs-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ArtifactStore(resolveConfig(), root);
  const artifactId = await store.save(Array.from({ length: 300 }, (_, index) => `line ${index}`).join("\n"), "fscheck");

  const exists = artifactExistsFactory(root);
  assert.equal(await exists(artifactId), true);
  assert.equal(await exists("fscheck.00000000-5717-4562-b3fc-2c963f66afa6"), false);
});
