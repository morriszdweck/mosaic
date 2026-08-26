import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { PluginManifest } from "./package.ts";

const PLUGIN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SKILLS = new Set(["agent-swarm", "customize-mosaic", "customize-opencode", "mosaic-self", "plugin-creator"]);

export function resolvePluginPath(directory: string, relativePath: string): string | undefined {
  const root = resolve(directory);
  const target = resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${sep}`)) return undefined;
  return target;
}

export function pathStat(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function isInside(root: string, target: string): boolean {
  return target.startsWith(`${root}${sep}`);
}

function hasSymlink(path: string): boolean {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return true;
  if (!stat.isDirectory()) return false;
  return readdirSync(path, { withFileTypes: true }).some((item) => hasSymlink(join(path, item.name)));
}

function hasSkillFrontmatter(path: string, expectedName: string): boolean {
  const contents = readFileSync(path, "utf8");
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatter = match?.[1];
  if (frontmatter === undefined) return false;
  const lines = frontmatter.split(/\r?\n/);
  const field = (name: string): string | undefined => {
    const line = lines.find((item) => item.trimStart().startsWith(`${name}:`));
    const value = line?.slice(line.indexOf(":") + 1).trim().replace(/^['"]|['"]$/g, "");
    return value || undefined;
  };
  return field("name") === expectedName && field("description") !== undefined;
}

export function pluginContentIssue(directory: string, manifest: PluginManifest): string | undefined {
  try {
    const root = realpathSync(directory);
    if (manifest.entry) {
      const entry = resolvePluginPath(directory, manifest.entry);
      const entryStat = entry ? lstatSync(entry) : undefined;
      if (!entry || !entryStat?.isFile() || !isInside(root, realpathSync(entry))) {
        return "entrypoint is missing, not a file, or escapes the package";
      }
    }
    for (const skillPath of manifest.skills ?? []) {
      const source = resolvePluginPath(directory, skillPath);
      const skillFile = source ? join(source, "SKILL.md") : undefined;
      const skillName = source ? basename(source) : undefined;
      const skillStat = skillFile ? pathStat(skillFile) : undefined;
      if (!source || !skillFile || !skillName || !PLUGIN_NAME.test(skillName) || !skillStat?.isFile()) {
        return "a declared skill is missing, invalid, or has no SKILL.md";
      }
      if (RESERVED_SKILLS.has(skillName)) return `skill name "${skillName}" is reserved by Mosaic`;
      if (!hasSkillFrontmatter(skillFile, skillName)) return "a declared skill has invalid frontmatter";
      if (!isInside(root, realpathSync(source)) || !isInside(root, realpathSync(skillFile)) || hasSymlink(source)) {
        return "a declared skill uses a symlink or escapes the package";
      }
    }
  } catch {
    return "declared plugin files are missing, unreadable, or escape the package";
  }
  return undefined;
}

export function pluginSkillConflict(home: string, manifest: PluginManifest): string | undefined {
  const destinationRoot = join(home, "config", "opencode", "skill");
  return (manifest.skills ?? []).map((skillPath) => basename(skillPath)).find((name) => pathStat(join(destinationRoot, name)) !== undefined);
}
