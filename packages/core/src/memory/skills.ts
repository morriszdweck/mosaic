import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileExists, skillsDirs } from "../util/paths.ts";

/**
 * Skills: directories containing a SKILL.md, discovered from
 * ~/.mosaic/skills/ and <cwd>/.mosaic/skills/.
 * The agent invokes them via the `skill` tool; only name+summary are
 * in the system prompt — the body loads on demand (token-efficient).
 */

export interface Skill {
  name: string;
  summary: string;
  body: string;
  dir: string;
}

export async function listSkills(cwd: string): Promise<Array<Pick<Skill, "name" | "summary" | "dir">>> {
  const out: Array<Pick<Skill, "name" | "summary" | "dir">> = [];
  for (const root of skillsDirs(cwd)) {
    if (!(await fileExists(root))) continue;
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(root, entry.name, "SKILL.md");
      if (!(await fileExists(skillFile))) continue;
      const body = await readFile(skillFile, "utf8");
      out.push({ name: entry.name, summary: firstMeaningfulLine(body), dir: join(root, entry.name) });
    }
  }
  return out;
}

export async function loadSkill(cwd: string, name: string): Promise<Skill | null> {
  for (const root of skillsDirs(cwd)) {
    const skillFile = join(root, name, "SKILL.md");
    if (!(await fileExists(skillFile))) continue;
    const body = await readFile(skillFile, "utf8");
    return { name, summary: firstMeaningfulLine(body), body, dir: join(root, name) };
  }
  return null;
}

function firstMeaningfulLine(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim().replace(/^#+\s*/, "");
    if (trimmed) return trimmed.slice(0, 200);
  }
  return "(no description)";
}
