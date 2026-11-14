import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function splitFrontmatter(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { frontmatter: "", body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

export function bodyOf(raw) {
  return splitFrontmatter(raw).body;
}

export function buildVariants(canonical) {
  const { frontmatter, body } = splitFrontmatter(canonical);
  const description = /description:\s*(.+)/.exec(frontmatter)?.[1]?.trim() ?? "";
  return [
    { path: "antigravity/token-saver/SKILL.md", content: canonical.replace(/\r\n/g, "\n") },
    { path: "cursor/token-saver.mdc", content: `---\ndescription: ${JSON.stringify(description)}\nglobs:\nalwaysApply: false\n---\n${body}` },
    { path: "cline/token-saver.md", content: body },
    { path: "goose/.goosehints", content: body },
    { path: "zed/token-saver.rules", content: body },
    { path: "agents/AGENTS.md", content: body },
  ];
}

export async function emitSkillVariants(root = "release/skills") {
  const canonical = await readFile("packages/mcp-server/skills/token-saver/SKILL.md", "utf8");
  for (const variant of buildVariants(canonical)) {
    const dest = path.join(root, variant.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, variant.content);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await emitSkillVariants();
}
