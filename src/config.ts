/**
 * Emits Mosaic's OpenCode config to stdout. The launcher writes it to
 * $MOSAIC_HOME/mosaic.json on every start.
 *
 * Generated rather than shipped as static JSON because the built-in plugin and
 * prompt entries have to be absolute paths into whatever directory this
 * install happens to live in, and because a user's own overrides get merged
 * on top.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AGENTS } from "./agents.ts";
import { BROWSER_COMMAND } from "./browser.ts";

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
  plugin?: NativePluginSpec[];
  agent?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  command?: Record<string, unknown>;
  [key: string]: unknown;
}

export type NativePluginSpec = string | [string, Record<string, unknown>];

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

    // These are Mosaic's own built-in server plugins. User plugins use the
    // same native OpenCode `plugin` array through config.json or the engine's
    // `plugin` command; they are never copied into a Mosaic-specific store.
    plugin: [
      join(root, "src", "plugin", "memory", "index.ts"),
      join(root, "src", "plugin", "schedule", "index.ts"),
      join(root, "src", "plugin", "evolve", "index.ts"),
      join(root, "src", "plugin", "checkpoint", "index.ts"),
      join(root, "src", "plugin", "hooks", "index.ts"),
      join(root, "src", "plugin", "keypool", "index.ts"),
    ],

    provider: PROVIDER_LABELS,
    command: BROWSER_COMMAND,

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

/**
 * Friendly names for the free OpenCode Zen models (https://opencode.ai/docs/zen,
 * plus whatever `GET https://opencode.ai/zen/v1/models` currently returns with
 * a `-free` suffix). `big-pickle` stays the default and keeps the "Mosaic Free"
 * name; the rest get their upstream names in readable form so the /model picker
 * never shows a bare codename.
 */
const PROVIDER_LABELS: Record<string, unknown> = {
  opencode: {
    name: "Free (via OC Zen)",
    models: {
      "big-pickle": { name: "Mosaic Free" },
      "muse-spark-1.3-contributor-free": { name: "Muse Spark 1.3 Free" },
      "muse-spark-1.2-contributor-free": { name: "Muse Spark 1.2 Free" },
      "mimo-v2.5-free": { name: "MiMo V2.5 Free" },
      "ling-3.0-flash-fin-free": { name: "Ling 3.0 Flash Fin Free" },
      "nemotron-3-ultra-free": { name: "Nemotron 3 Ultra Free" },
      "nemotron-3.5-lightning-free": { name: "Nemotron 3.5 Lightning Free" },
      "deepseek-v4-flash-free": { name: "DeepSeek V4 Flash Free" },
      "laguna-s-2.1-free": { name: "Laguna S 2.1 Free" },
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
    // Installed from themes/mosaic-light.json; the engine's own default is "opencode".
    theme: "mosaic-light",
    plugin: [join(root, "src", "plugin", "branding", "index.tsx")],
  };
}

/**
 * Merge the generated TUI config over whatever is already on disk.
 *
 * The launcher rewrites tui.json on every start so the plugin path tracks the
 * install. Writing it wholesale threw away the user's own interface settings —
 * pick `mosaic-dark` with /theme and the next launch silently put `mosaic`
 * back, which reads as the theme not working at all.
 *
 * Generated keys win where they must (the plugin path has to be current);
 * everything the user set, including `theme`, is preserved.
 */
export function mergeTuiConfig(
  generated: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...generated, ...existing };
  // Keep Mosaic's built-in branding first, then carry through native TUI
  // plugins the user configured. Old branding paths are not user plugins.
  const builtinPlugins = Array.isArray(generated.plugin) ? generated.plugin : [];
  const userPlugins = Array.isArray(existing.plugin) ? existing.plugin : [];
  merged.plugin = [
    ...builtinPlugins,
    ...userPlugins.filter((plugin) => !isBrandingPath(plugin)),
  ];
  if (isRecord(existing.plugin_enabled)) {
    const pluginEnabled = { ...existing.plugin_enabled };
    delete pluginEnabled["mosaic-branding"];
    if (Object.keys(pluginEnabled).length === 0) delete merged.plugin_enabled;
    else merged.plugin_enabled = pluginEnabled;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrandingPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.endsWith("/branding.tsx") || value.endsWith("\\branding.tsx");
}

/** Read the TUI config already on disk, if any. */
export async function readTuiConfig(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    // A hand-edited file with a typo should not wipe the user's settings.
    return {};
  }
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
    command: { ...(base.command ?? {}), ...(over.command ?? {}) },
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
    const path = process.argv[process.argv.indexOf("--tui") + 1];
    const existing = path ? await readTuiConfig(path) : {};
    process.stdout.write(JSON.stringify(mergeTuiConfig(buildTuiConfig(), existing), null, 2));
  } else {
    let config = await withUserOverrides(buildConfig(), MOSAIC_HOME);
    // Project config sits closest to the work, so it wins over the global one.
    const project = await loadProjectConfig();
    if (project) config = mergeConfig(config, project);
    process.stdout.write(JSON.stringify(config, null, 2));
  }
}
