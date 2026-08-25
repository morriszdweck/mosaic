import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configPath, fileExists, projectConfigDir } from "./util/paths.ts";
import { mergeToml, parseToml } from "./util/toml.ts";
import { conventionalKeyEnv, PROVIDER_PRESETS } from "./providers/presets.ts";

/**
 * Configuration resolution: sensible defaults, no mandatory config file.
 * Precedence: defaults < ~/.mosaic/config.toml < <cwd>/.mosaic/config.toml < env vars.
 */

export interface MosaicConfig {
  /** Default model in "provider:model" form, e.g. "openai:gpt-4o" or "anthropic:claude-sonnet-4-5". */
  model: string;
  /** Small/cheap model used for compaction and subagent routing. */
  smallModel: string;
  maxTokens: number;
  temperature: number;
  providers: Record<string, ProviderConfig>;
  tools: ToolsConfig;
  memory: MemoryConfig;
  tokens: TokenConfig;
  permissions: PermissionsConfig;
  search: SearchConfig;
  /**
   * Keys saved by `mosaic login <provider> --key`, loaded from the auth store at
   * runtime assembly. Kept separate from `providers[].apiKey` (which comes from
   * config.toml) so precedence stays explicit — see resolveApiKey.
   */
  storedKeys: Record<string, string>;
}

export interface ProviderConfig {
  /** OpenAI-compatible base URL override (also covers Ollama, LM Studio, OpenRouter, Groq). */
  baseUrl?: string;
  /** Explicit API key (prefer env vars; this is for convenience). */
  apiKey?: string;
  /** Env var name to read the API key from. Defaults per provider. */
  apiKeyEnv?: string;
}

export interface ToolsConfig {
  /** Per-tool output cap in characters before head/tail elision. */
  outputLimit: number;
  bashTimeoutMs: number;
  /** Tools that always require explicit permission. */
  alwaysAsk: string[];
}

export interface MemoryConfig {
  enabled: boolean;
  /** Max memories recalled per turn. */
  recallLimit: number;
  /** Size cap (chars) for auto-loaded project memory files. */
  projectFileCap: number;
}

export interface TokenConfig {
  /** Context window size of the active model, used for the 80% compaction trigger. */
  contextWindow: number;
  /** Fraction of the context window that triggers auto-compaction. */
  compactAt: number;
  /** Verbatim turns kept after compaction. */
  keepLastTurns: number;
  /** Lazy tool schemas: only inject heavy descriptions when relevant. */
  lazyToolSchemas: boolean;
}

export interface PermissionsConfig {
  /** "ask" (default) | "allow-read-only" (auto-approve reads) | "yolo" (never ask). */
  mode: "ask" | "allow-read-only" | "yolo";
}

export interface SearchConfig {
  /** "duckduckgo" (keyless default) | "brave" | "tavily" */
  backend: "duckduckgo" | "brave" | "tavily";
  braveApiKey?: string;
  tavilyApiKey?: string;
}

export const DEFAULT_CONFIG: MosaicConfig = {
  model: "openai:gpt-4o-mini",
  smallModel: "openai:gpt-4o-mini",
  maxTokens: 8192,
  temperature: 0.2,
  // Derived from the preset table so a provider is added in exactly one place.
  providers: Object.fromEntries(
    Object.entries(PROVIDER_PRESETS).map(([name, preset]) => [
      name,
      { baseUrl: preset.baseUrl, apiKeyEnv: preset.apiKeyEnv },
    ]),
  ),
  tools: {
    outputLimit: 30_000,
    bashTimeoutMs: 120_000,
    alwaysAsk: ["write", "edit", "bash"],
  },
  memory: {
    enabled: true,
    recallLimit: 5,
    projectFileCap: 20_000,
  },
  tokens: {
    contextWindow: 128_000,
    compactAt: 0.8,
    keepLastTurns: 4,
    lazyToolSchemas: true,
  },
  permissions: {
    mode: "ask",
  },
  search: {
    backend: "duckduckgo",
  },
  storedKeys: {},
};

export async function loadConfig(cwd: string = process.cwd()): Promise<MosaicConfig> {
  let raw: Record<string, unknown> = {};

  if (await fileExists(configPath())) {
    raw = { ...raw, ...parseToml(await readFile(configPath(), "utf8")) };
  }

  const projectConfig = join(projectConfigDir(cwd), "config.toml");
  if (await fileExists(projectConfig)) {
    raw = mergeToml(raw as never, parseToml(await readFile(projectConfig, "utf8")) as never) as Record<
      string,
      unknown
    >;
  }

  const cfg = structuredClone(DEFAULT_CONFIG);
  applyOverrides(cfg, raw);
  applyEnv(cfg);
  return cfg;
}

function applyOverrides(cfg: MosaicConfig, raw: Record<string, unknown>): void {
  if (typeof raw.model === "string") cfg.model = raw.model;
  if (typeof raw.small_model === "string") cfg.smallModel = raw.small_model;
  if (typeof raw.max_tokens === "number") cfg.maxTokens = raw.max_tokens;
  if (typeof raw.temperature === "number") cfg.temperature = raw.temperature;

  const providers = raw.providers as Record<string, Record<string, unknown>> | undefined;
  if (providers) {
    for (const [name, p] of Object.entries(providers)) {
      cfg.providers[name] = {
        baseUrl: typeof p.base_url === "string" ? p.base_url : cfg.providers[name]?.baseUrl,
        apiKey: typeof p.api_key === "string" ? p.api_key : cfg.providers[name]?.apiKey,
        apiKeyEnv: typeof p.api_key_env === "string" ? p.api_key_env : cfg.providers[name]?.apiKeyEnv,
      };
    }
  }

  const tools = raw.tools as Record<string, unknown> | undefined;
  if (tools) {
    if (typeof tools.output_limit === "number") cfg.tools.outputLimit = tools.output_limit;
    if (typeof tools.bash_timeout_ms === "number") cfg.tools.bashTimeoutMs = tools.bash_timeout_ms;
    if (Array.isArray(tools.always_ask)) cfg.tools.alwaysAsk = tools.always_ask.filter((x) => typeof x === "string");
  }

  const memory = raw.memory as Record<string, unknown> | undefined;
  if (memory) {
    if (typeof memory.enabled === "boolean") cfg.memory.enabled = memory.enabled;
    if (typeof memory.recall_limit === "number") cfg.memory.recallLimit = memory.recall_limit;
    if (typeof memory.project_file_cap === "number") cfg.memory.projectFileCap = memory.project_file_cap;
  }

  const tokens = raw.tokens as Record<string, unknown> | undefined;
  if (tokens) {
    if (typeof tokens.context_window === "number") cfg.tokens.contextWindow = tokens.context_window;
    if (typeof tokens.compact_at === "number") cfg.tokens.compactAt = tokens.compact_at;
    if (typeof tokens.keep_last_turns === "number") cfg.tokens.keepLastTurns = tokens.keep_last_turns;
    if (typeof tokens.lazy_tool_schemas === "boolean") cfg.tokens.lazyToolSchemas = tokens.lazy_tool_schemas;
  }

  const perms = raw.permissions as Record<string, unknown> | undefined;
  if (perms && (perms.mode === "ask" || perms.mode === "allow-read-only" || perms.mode === "yolo")) {
    cfg.permissions.mode = perms.mode;
  }

  const search = raw.search as Record<string, unknown> | undefined;
  if (search) {
    if (search.backend === "duckduckgo" || search.backend === "brave" || search.backend === "tavily") {
      cfg.search.backend = search.backend;
    }
    if (typeof search.brave_api_key === "string") cfg.search.braveApiKey = search.brave_api_key;
    if (typeof search.tavily_api_key === "string") cfg.search.tavilyApiKey = search.tavily_api_key;
  }
}

function applyEnv(cfg: MosaicConfig): void {
  if (process.env.MOSAIC_MODEL) cfg.model = process.env.MOSAIC_MODEL;
  if (process.env.MOSAIC_SEARCH_BACKEND === "brave" || process.env.MOSAIC_SEARCH_BACKEND === "tavily") {
    cfg.search.backend = process.env.MOSAIC_SEARCH_BACKEND;
  }
  if (process.env.BRAVE_API_KEY) cfg.search.braveApiKey = process.env.BRAVE_API_KEY;
  if (process.env.TAVILY_API_KEY) cfg.search.tavilyApiKey = process.env.TAVILY_API_KEY;
}

/** Env var a provider's key is read from, falling back to the NAME_API_KEY convention. */
export function keyEnvFor(cfg: MosaicConfig, provider: string): string {
  return cfg.providers[provider]?.apiKeyEnv ?? PROVIDER_PRESETS[provider]?.apiKeyEnv ?? conventionalKeyEnv(provider);
}

/**
 * Resolve the API key for a provider: config.toml > env var > saved login.
 *
 * Two fixes live here. Providers with no config entry now fall back to the
 * NAME_API_KEY convention, so a `deepseek:` model works off DEEPSEEK_API_KEY
 * alone — previously this returned nothing while the error text told you to set
 * exactly that variable. And keys saved by `mosaic login --key` are consulted at
 * all: nothing read them back before, so the documented BYOK path silently did
 * nothing and only env vars ever worked.
 *
 * Env beats a saved key because exporting a variable is a deliberate act in the
 * shell you are in; the saved key is the persistent default underneath it.
 */
export function resolveApiKey(cfg: MosaicConfig, provider: string): string | undefined {
  const p = cfg.providers[provider];
  if (p?.apiKey) return p.apiKey;
  return process.env[keyEnvFor(cfg, provider)] || cfg.storedKeys[provider] || undefined;
}
