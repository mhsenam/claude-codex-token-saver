import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

await rm("release", { recursive: true, force: true });
for (const host of ["claude", "codex"]) {
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
console.log("Created release/claude/token-saver and release/codex/token-saver");
