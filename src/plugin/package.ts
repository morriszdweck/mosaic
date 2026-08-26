import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

export const PLUGIN_MANIFEST = "mosaic-plugin.json" as const;

const MOSAIC_HOME = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
const PLUGIN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly entry?: string;
  readonly skills?: readonly string[];
}

export type ManifestResult =
  | { readonly ok: true; readonly value: PluginManifest }
  | { readonly ok: false; readonly message: string };

interface InstalledPlugin {
  readonly directory: string;
  readonly manifest: PluginManifest;
  readonly entry?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePluginManifest(value: unknown): ManifestResult {
  if (!isRecord(value)) return { ok: false, message: "manifest must be a JSON object" };
  const name = value.name;
  const version = value.version;
  const description = value.description;
  if (!stringField(name) || !PLUGIN_NAME.test(name)) {
    return { ok: false, message: "name must be lowercase words joined by hyphens" };
  }
  if (!stringField(version)) return { ok: false, message: "version is required" };
  if (!stringField(description)) return { ok: false, message: "description is required" };

  const entry = value.entry;
  if (entry !== undefined && !stringField(entry)) return { ok: false, message: "entry must be a relative file path" };

  const rawSkills = value.skills;
  if (rawSkills !== undefined && (!Array.isArray(rawSkills) || rawSkills.some((skill: unknown) => !stringField(skill)))) {
    return { ok: false, message: "skills must be an array of non-empty relative paths" };
  }

  const skills = Array.isArray(rawSkills) ? rawSkills.filter((skill: unknown): skill is string => typeof skill === "string") : [];
  if (entry === undefined && skills.length === 0) return { ok: false, message: "plugin must provide entry or skills" };

  return {
    ok: true,
    value: {
      name,
      version,
      description,
      ...(entry === undefined ? {} : { entry }),
      ...(skills.length === 0 ? {} : { skills }),
    },
  };
}

function readManifest(path: string): ManifestResult {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsePluginManifest(value);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function pluginDirectory(home = MOSAIC_HOME): string {
  return join(home, "plugins");
}

export function resolvePluginPath(directory: string, relativePath: string): string | undefined {
  const root = resolve(directory);
  const target = resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${sep}`)) return undefined;
  return target;
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

function pluginContentIssue(directory: string, manifest: PluginManifest): string | undefined {
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
      const skillStat = skillFile && existsSync(skillFile) ? lstatSync(skillFile) : undefined;
      if (!source || !skillFile || !PLUGIN_NAME.test(basename(source)) || !skillStat?.isFile()) {
        return "a declared skill is missing, invalid, or has no SKILL.md";
      }
      if (!isInside(root, realpathSync(source)) || !isInside(root, realpathSync(skillFile)) || hasSymlink(source)) {
        return "a declared skill uses a symlink or escapes the package";
      }
    }
  } catch {
    return "declared plugin files are missing, unreadable, or escape the package";
  }
  return undefined;
}

export function installedPlugins(home = MOSAIC_HOME): readonly InstalledPlugin[] {
  const root = pluginDirectory(home);
  if (!existsSync(root)) return [];
  const plugins: InstalledPlugin[] = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const directory = join(root, item.name);
    const parsed = readManifest(join(directory, PLUGIN_MANIFEST));
    if (!parsed.ok) {
      process.stderr.write(`mosaic: skipping plugin ${item.name}: ${parsed.message}\n`);
      continue;
    }
    const issue = pluginContentIssue(directory, parsed.value);
    if (issue) {
      process.stderr.write(`mosaic: skipping plugin ${parsed.value.name}: ${issue}\n`);
      continue;
    }
    const entry = parsed.value.entry ? resolvePluginPath(directory, parsed.value.entry) : undefined;
    plugins.push({ directory, manifest: parsed.value, ...(entry === undefined ? {} : { entry }) });
  }
  return plugins;
}

export function pluginEntries(home = MOSAIC_HOME): readonly string[] {
  return installedPlugins(home).flatMap((plugin) => (plugin.entry === undefined ? [] : [plugin.entry]));
}

export interface PluginSyncResult {
  readonly synced: readonly string[];
  readonly skipped: readonly string[];
}

export async function syncPluginSkills(home = MOSAIC_HOME): Promise<PluginSyncResult> {
  const destinationRoot = join(home, "config", "opencode", "skill");
  await mkdir(destinationRoot, { recursive: true });
  const synced: string[] = [];
  const skipped: string[] = [];

  for (const plugin of installedPlugins(home)) {
    for (const skillPath of plugin.manifest.skills ?? []) {
      const source = resolvePluginPath(plugin.directory, skillPath);
      if (!source) {
        const skillName = basename(skillPath);
        skipped.push(`${plugin.manifest.name}/${skillName}`);
        continue;
      }
      const skillName = basename(source);
      const destination = join(destinationRoot, skillName);
      const marker = join(destination, ".mosaic-plugin");
      const destinationStat = existsSync(destination) ? lstatSync(destination) : undefined;
      if (destinationStat && (!destinationStat.isDirectory() || destinationStat.isSymbolicLink() || !existsSync(marker) || (await readFile(marker, "utf8")).trim() !== plugin.manifest.name)) {
        skipped.push(`${plugin.manifest.name}/${skillName}`);
        continue;
      }
      await cp(source, destination, { recursive: true });
      await writeFile(marker, `${plugin.manifest.name}\n`);
      synced.push(`${plugin.manifest.name}/${skillName}`);
    }
  }
  return { synced, skipped };
}

export type GithubRepositoryResult =
  | { readonly ok: true; readonly url: string; readonly name: string }
  | { readonly ok: false; readonly message: string };

export function githubRepository(spec: string): GithubRepositoryResult {
  const input = spec.trim();
  const candidate = input.startsWith("http://") || input.startsWith("https://") ? input : `https://github.com/${input}`;
  try {
    const url = new URL(candidate);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return { ok: false, message: "plugin sources must be GitHub repositories" };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return { ok: false, message: "use a GitHub repository URL such as https://github.com/owner/plugin" };
    const owner = parts[0];
    const repositoryName = parts[1];
    if (!owner || !repositoryName) return { ok: false, message: "use a GitHub repository URL such as https://github.com/owner/plugin" };
    const name = repositoryName.replace(/\.git$/, "");
    if (!PLUGIN_NAME.test(name)) return { ok: false, message: "repository name must use lowercase words joined by hyphens" };
    return { ok: true, name, url: `https://github.com/${owner}/${name}.git` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export type PluginInstallResult =
  | { readonly ok: true; readonly directory: string; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly message: string };

export async function installPlugin(spec: string, home = MOSAIC_HOME): Promise<PluginInstallResult> {
  const repository = githubRepository(spec);
  if (!repository.ok) return repository;
  const temporary = await mkdtemp(join(tmpdir(), "mosaic-plugin-"));
  const checkout = join(temporary, "repo");
  try {
    const clone = spawnSync("git", ["clone", "--depth", "1", repository.url, checkout], { encoding: "utf8" });
    if (clone.error || clone.status !== 0) {
      return { ok: false, message: String(clone.error ?? clone.stderr ?? "git clone failed").trim() };
    }
    const parsed = readManifest(join(checkout, PLUGIN_MANIFEST));
    if (!parsed.ok) return { ok: false, message: `invalid ${PLUGIN_MANIFEST}: ${parsed.message}` };
    const issue = pluginContentIssue(checkout, parsed.value);
    if (issue) return { ok: false, message: `invalid ${PLUGIN_MANIFEST}: ${issue}` };

    const target = join(pluginDirectory(home), parsed.value.name);
    if (existsSync(target)) return { ok: false, message: `plugin "${parsed.value.name}" is already installed` };
    await mkdir(pluginDirectory(home), { recursive: true });

    if (parsed.value.entry && existsSync(join(checkout, "package.json"))) {
      const install = spawnSync("bun", ["install", "--cwd", checkout, "--production"], { encoding: "utf8" });
      if (install.error || install.status !== 0) {
        return { ok: false, message: String(install.error ?? install.stderr ?? "bun install failed").trim() };
      }
    }
    await rename(checkout, target);
    return { ok: true, directory: target, manifest: parsed.value };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
