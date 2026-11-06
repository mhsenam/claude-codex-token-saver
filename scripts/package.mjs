import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

await rm("release", { recursive: true, force: true });

for (const host of ["claude", "codex", "qoder"]) {
  const sourceRoot = path.resolve(`packages/${host}`);
  const destination = `release/${host}/token-saver`;
  await mkdir(destination, { recursive: true });
  await cp(sourceRoot, destination, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceRoot, source);
      if (!relative) return true;
      const [first] = relative.split(path.sep);
      return !["src", "test", "node_modules"].includes(first) && relative !== "package.json";
    },
  });
}

const opencodeRoot = path.resolve("packages/opencode");
await cp(opencodeRoot, "release/opencode", {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(opencodeRoot, source);
    if (!relative) return true;
    const [first] = relative.split(path.sep);
    return !["src", "test", "node_modules"].includes(first);
  },
});

console.log(
  "Created release/claude/token-saver, release/codex/token-saver, release/qoder/token-saver, and release/opencode",
);
