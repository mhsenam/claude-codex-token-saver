import { ArtifactStore, defaultConfig } from "../../core/src/index.js";
import type { CompactionConfig } from "../../core/src/index.js";

export function testStore(root: string, config: CompactionConfig = defaultConfig): ArtifactStore {
  return new ArtifactStore(config, root);
}
