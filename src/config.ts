/**
 * Emits Mosaic's OpenCode config to stdout. The launcher writes it to
 * $MOSAIC_HOME/mosaic.json on every start.
 *
 * Generated rather than shipped as static JSON because the plugin and prompt
 * entries have to be absolute paths into whatever directory this install
 * happens to live in, and because a user's own overrides get merged on top.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AGENTS } from "./agents.ts";

const ROOT = process.env.MOSAIC_ROOT ?? resolve(import.meta.dir, "..");
const MOSAIC_HOME = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");

/**
 * The engine's config keys are singular — `agent`, `plugin`. Unknown keys are
 * dropped silently rather than rejected, so a plural typo here costs you the
 * agents and the memory plugin with no error at all.
 */
export interface MosaicConfig {
  $schema?: string;
  model?: string;
  default_agent?: string;
  autoupdate?: boolean;
  share?: "manual" | "auto" | "disabled";
  instructions?: string[];
  plugin?: string[];
  agent?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  [key: string]: unknown;
}

export function buildConfig(root = ROOT, home = MOSAIC_HOME): MosaicConfig {
  return {
    // A general-purpose assistant should not be publishing conversations
    // anywhere by default, and updates come through Mosaic's own release.
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    autoupdate: false,

    // A default that works with no key and no account, so a fresh install is
    // usable even if setup is skipped. ~/.mosaic/config.json overrides it.
    model: DEFAULT_MODEL,

    // Titles, summaries and compaction run on small_model. Left unset the
    // engine picks its own, which on the free tier can be slower than the
    // model you actually chose — so default it to the same one. Setup writes
    // an explicit pairing for paid providers, where a cheap companion is both
    // faster and cheaper than the main model.
    small_model: DEFAULT_MODEL,

    default_agent: "mosaic",
    agent: AGENTS,

    // The base instructions that make this a general assistant rather than a
    // coding tool. Agent-level `system` prompts layer on top of these.
    // SOUL.md is the user's own: tone, name, standing preferences. It comes
    // last so it can override anything Mosaic says about itself.
    instructions: [join(root, "prompts", "mosaic.md"), ...soulFiles(home)],

    // Memory is Mosaic's own addition — see src/plugin/memory.
    plugin: [
      join(root, "src", "plugin", "memory", "index.ts"),
      join(root, "src", "plugin", "schedule", "index.ts"),
      join(root, "src", "plugin", "evolve", "index.ts"),
    ],

    provider: PROVIDER_LABELS,

    // Skills are the engine's own feature and it discovers them itself, under
    // the XDG directories the launcher already points at $MOSAIC_HOME.
  };
}

/**
 * Display names for providers and models.
 *
 * The engine's free models arrive with their upstream codenames, which say
 * nothing to someone picking a model. Renaming them is presentation only — the
 * provider keeps "OC Zen" in its label, because the inference is OpenCode's and
 * a user choosing a free model should be able to see whose it is.
 */
export const DEFAULT_MODEL = "opencode/big-pickle";

const PROVIDER_LABELS: Record<string, unknown> = {
  opencode: {
    name: "Free (via OC Zen)",
    models: {
      "big-pickle": { name: "Mosaic Free" },
    },
  },
};

/**
 * Personality files, in the order they should be applied.
 *
 * Borrowed from Hermes' SOUL.md: a place to say "call me X, be blunt, always
 * answer in metric" once instead of at the start of every conversation. Both
 * locations are optional and neither is created for you.
 */
function soulFiles(home: string): string[] {
  return [join(home, "SOUL.md")].filter((p) => existsSync(p));
}

/**
 * The TUI is configured separately from the agent, in its own `tui.json` under
 * $XDG_CONFIG_HOME/opencode. Plugins listed in the main config only get their
 * `server` half loaded, so Mosaic's branding — which renders into TUI slots —
 * has to be registered here or it is accepted and silently never drawn.
 */
export function buildTuiConfig(root = ROOT): Record<string, unknown> {
  return {
    // Installed from themes/mosaic.json; the engine's own default is "opencode".
    theme: "mosaic",
    plugin: [join(root, "src", "plugin", "branding", "index.tsx")],
  };
}

/**
 * Mosaic's own per-project config, replacing the engine's.
 *
 * The engine finds project config by filename, walking up from the working
 * directory for `opencode.json` and `.opencode/`. That is how an OpenCode
 * user's providers ended up inside Mosaic — a `~/opencode.json` applies to
 * everything under the home directory. The launcher turns that discovery off,
 * so this restores the feature under names that cannot collide.
 *
 * Nearest file wins, and only the first is read: a project config is a
 * statement about one project, not a layer in a stack.
 */
export async function loadProjectConfig(
  from: string = process.cwd(),
  home = MOSAIC_HOME,
): Promise<MosaicConfig | null> {
  let dir = resolve(from);
  // A `.mosaic` that is somebody's *global* config directory is not a project
  // config. Without this, walking up from any directory under $HOME finds
  // ~/.mosaic/config.json and applies the global config a second time,
  // duplicating every array in it. Both the configured home and the
  // conventional one are excluded, since they can differ.
  const globalDirs = new Set([resolve(home), resolve(join(homedir(), ".mosaic"))]);
  for (;;) {
    if (globalDirs.has(join(dir, ".mosaic"))) {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
      continue;
    }
    for (const candidate of [join(dir, ".mosaic", "config.json"), join(dir, "mosaic.json")]) {
      if (!existsSync(candidate)) continue;
      try {
        return JSON.parse(await readFile(candidate, "utf8")) as MosaicConfig;
      } catch (error) {
        process.stderr.write(`mosaic: ignoring ${candidate}: ${error instanceof Error ? error.message : error}\n`);
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Layer one config over another: arrays extend, agents merge by name. */
export function mergeConfig(base: MosaicConfig, over: MosaicConfig): MosaicConfig {
  return {
    ...base,
    ...over,
    instructions: [...(base.instructions ?? []), ...(over.instructions ?? [])],
    plugin: [...(base.plugin ?? []), ...(over.plugin ?? [])],
    agent: { ...(base.agent ?? {}), ...(over.agent ?? {}) },
    provider: { ...(base.provider ?? {}), ...(over.provider ?? {}) },
  };
}

/** Merge the user's ~/.mosaic/config.json over the generated defaults. */
async function withUserOverrides(base: MosaicConfig, home: string): Promise<MosaicConfig> {
  const path = join(home, "config.json");
  if (!existsSync(path)) return base;
  try {
    const user = JSON.parse(await readFile(path, "utf8")) as MosaicConfig;
    // Arrays concatenate so a user adding a plugin extends Mosaic rather than
    // silently replacing what makes it Mosaic.
    return mergeConfig(base, user);
  } catch (error) {
    // A broken override should not stop Mosaic from starting.
    process.stderr.write(`mosaic: ignoring ${path}: ${error instanceof Error ? error.message : error}\n`);
    return base;
  }
}

if (import.meta.main) {
  if (process.argv.includes("--tui")) {
    process.stdout.write(JSON.stringify(buildTuiConfig(), null, 2));
  } else {
    let config = await withUserOverrides(buildConfig(), MOSAIC_HOME);
    // Project config sits closest to the work, so it wins over the global one.
    const project = await loadProjectConfig();
    if (project) config = mergeConfig(config, project);
    process.stdout.write(JSON.stringify(config, null, 2));
  }
}
