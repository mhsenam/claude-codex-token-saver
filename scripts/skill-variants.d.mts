export interface SkillVariant { path: string; content: string; }
export function splitFrontmatter(raw: string): { frontmatter: string; body: string };
export function bodyOf(raw: string): string;
export function buildVariants(canonical: string): SkillVariant[];
export function emitSkillVariants(root?: string): Promise<void>;
