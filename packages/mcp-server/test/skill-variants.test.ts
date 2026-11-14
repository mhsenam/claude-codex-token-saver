import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bodyOf, buildVariants, emitSkillVariants } from "../../../scripts/skill-variants.mjs";

test("skill variants preserve body content identity", async () => {
  const canonical = await readFile("packages/mcp-server/skills/token-saver/SKILL.md", "utf8");
  const canonicalBody = bodyOf(canonical);
  assert.ok(canonicalBody.trimStart().startsWith("# Token Saver"), "canonical frontmatter was not stripped from the body");
  const variants = buildVariants(canonical);
  assert.ok(variants.length >= 6, "expected at least six host wrappers");
  for (const variant of variants) {
    assert.equal(bodyOf(variant.content), canonicalBody, `body drifted in ${variant.path}`);
  }
  const cursor = variants.find((v) => v.path === "cursor/token-saver.mdc");
  assert.ok(cursor, "missing cursor wrapper");
  const cursorDescription = /^description:[ \t]*(.*)$/m.exec(cursor.content)?.[1]?.trim() ?? "";
  assert.ok(cursorDescription.length > 0, "cursor frontmatter description is empty");
  const paths = variants.map((v) => v.path);
  for (const required of ["cursor/token-saver.mdc", "cline/token-saver.md", "goose/.goosehints", "zed/token-saver.rules", "agents/AGENTS.md", "antigravity/token-saver/SKILL.md"]) {
    assert.ok(paths.includes(required), `missing wrapper ${required}`);
  }
});

test("emitSkillVariants writes all six wrappers to disk with the canonical body", async (t) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "token-saver-skills-"));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));
  const canonical = await readFile("packages/mcp-server/skills/token-saver/SKILL.md", "utf8");
  const canonicalBody = bodyOf(canonical);
  await emitSkillVariants(tmpDir);
  for (const wrapper of ["antigravity/token-saver/SKILL.md", "cursor/token-saver.mdc", "cline/token-saver.md", "goose/.goosehints", "zed/token-saver.rules", "agents/AGENTS.md"]) {
    const onDisk = await readFile(path.join(tmpDir, wrapper), "utf8");
    assert.equal(bodyOf(onDisk), canonicalBody, `disk body drifted in ${wrapper}`);
  }
});

test("CRLF canonical normalizes to the LF body in every wrapper", async () => {
  const canonical = await readFile("packages/mcp-server/skills/token-saver/SKILL.md", "utf8");
  const crlf = canonical.replace(/\n/g, "\r\n");
  const canonicalBody = bodyOf(canonical);
  for (const variant of buildVariants(crlf)) {
    assert.equal(bodyOf(variant.content), canonicalBody, `CRLF body drifted in ${variant.path}`);
  }
});
