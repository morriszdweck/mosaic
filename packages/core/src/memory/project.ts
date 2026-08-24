import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileExists } from "../util/paths.ts";

/**
 * Project memory: MOSAIC.md / AGENTS.md files, auto-loaded with a size cap.
 * Also walks up parent directories so monorepo sub-packages inherit root memory.
 */

export interface ProjectMemory {
  path: string;
  content: string;
  truncated: boolean;
}

const FILENAMES = ["MOSAIC.md", "AGENTS.md"];

export async function loadProjectMemory(cwd: string, cap: number): Promise<ProjectMemory[]> {
  const out: ProjectMemory[] = [];
  let dir = cwd;
  const seen = new Set<string>();

  for (;;) {
    for (const name of FILENAMES) {
      const path = join(dir, name);
      if (seen.has(path) || !(await fileExists(path))) continue;
      seen.add(path);
      const raw = await readFile(path, "utf8");
      out.push({
        path,
        content: raw.length > cap ? raw.slice(0, cap) : raw,
        truncated: raw.length > cap,
      });
    }
    const parent = join(dir, "..");
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return out;
}
