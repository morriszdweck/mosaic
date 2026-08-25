/**
 * Swarm mode.
 *
 * opencode-swarm (github.com/morriszdweck/opencode-swarm) ships an orchestrator
 * agent and a handful of specialists as markdown. Its own installer writes them
 * into ~/.config/opencode, which is the OpenCode install Mosaic deliberately
 * keeps out of — so Mosaic syncs them into its own agent directory instead.
 *
 * The sync runs on every launch, which keeps a reinstall of the vendored copy
 * live without a separate step, and repairs a half-deleted install.
 *
 * A manifest records what Mosaic wrote. Anything not in it is the user's, and
 * is never overwritten: agent names are a flat namespace, and silently
 * replacing someone's `reviewer.md` would be indefensible.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const MOSAIC_HOME = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");

export interface SwarmPaths {
  /** Vendored checkout, as placed by install.sh. */
  source: string;
  /** $XDG_CONFIG_HOME/opencode, where the engine looks. */
  configDir: string;
}

export function defaultPaths(root: string, home = MOSAIC_HOME): SwarmPaths {
  return {
    source: join(root, "vendor", "swarm"),
    configDir: join(home, "config", "opencode"),
  };
}

interface Manifest {
  agents: string[];
  skills: string[];
}

const MANIFEST = "swarm-manifest.json";

async function readManifest(configDir: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(join(configDir, MANIFEST), "utf8")) as Manifest;
  } catch {
    return { agents: [], skills: [] };
  }
}

export interface SyncResult {
  installed: string[];
  /** Files left alone because the user owns them. */
  skipped: string[];
  removed: string[];
}

/**
 * Copy swarm's agents and skills into Mosaic's config directory.
 *
 * Returns a summary rather than logging, so the launcher can stay quiet on the
 * common path where nothing changed.
 */
export async function syncSwarm(paths: SwarmPaths): Promise<SyncResult> {
  const result: SyncResult = { installed: [], skipped: [], removed: [] };
  const agentSrc = join(paths.source, "agents");
  if (!existsSync(agentSrc)) return result; // not vendored — swarm is optional

  const previous = await readManifest(paths.configDir);
  const agentDir = join(paths.configDir, "agent");
  const skillDir = join(paths.configDir, "skill");
  await mkdir(agentDir, { recursive: true });
  await mkdir(skillDir, { recursive: true });

  const manifest: Manifest = { agents: [], skills: [] };

  for (const file of (await readdir(agentSrc)).filter((f) => f.endsWith(".md"))) {
    const dest = join(agentDir, file);
    // Ours to manage only if we wrote it, or nothing is there.
    if (existsSync(dest) && !previous.agents.includes(file)) {
      result.skipped.push(file);
      continue;
    }
    await cp(join(agentSrc, file), dest);
    manifest.agents.push(file);
    result.installed.push(file);
  }

  const skillSrc = join(paths.source, "skills");
  if (existsSync(skillSrc)) {
    for (const name of await readdir(skillSrc)) {
      const dest = join(skillDir, name);
      if (existsSync(dest) && !previous.skills.includes(name)) {
        result.skipped.push(name);
        continue;
      }
      await cp(join(skillSrc, name), dest, { recursive: true });
      manifest.skills.push(name);
      result.installed.push(name);
    }
  }

  // Drop anything we installed previously that swarm no longer ships, so a
  // renamed agent does not linger forever.
  for (const file of previous.agents) {
    if (manifest.agents.includes(file)) continue;
    await rm(join(agentDir, file), { force: true });
    result.removed.push(file);
  }
  for (const name of previous.skills) {
    if (manifest.skills.includes(name)) continue;
    await rm(join(skillDir, name), { recursive: true, force: true });
    result.removed.push(name);
  }

  await writeFile(join(paths.configDir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  return result;
}

/** Agent names swarm contributes, for docs and for the reserved-name warning. */
export async function swarmAgentNames(source: string): Promise<string[]> {
  const dir = join(source, "agents");
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md")).sort();
}

if (import.meta.main) {
  const root = process.env.MOSAIC_ROOT ?? join(import.meta.dir, "..");
  const result = await syncSwarm(defaultPaths(root));
  if (result.skipped.length) {
    process.stderr.write(`mosaic: kept your own ${result.skipped.join(", ")} (swarm did not overwrite them)\n`);
  }
}
