import type { Plugin } from "@opencode-ai/plugin";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Credential pools: several keys for one provider, used in turn.
 *
 * Free and low tiers rate-limit per key, so the usual failure is not "no
 * access" but "not right now". Rotating across keys turns that into a delay
 * rather than a stop.
 *
 * Configured in ~/.mosaic/config.json:
 *
 *   { "keys": { "anthropic": ["sk-a", "sk-b"] } }
 *
 * Rotation is round-robin per request rather than only-on-failure, which
 * spreads load instead of hammering one key until it trips. The engine still
 * owns the primary credential; a pool only takes over when one is configured
 * for that provider.
 */

export type KeyPools = Record<string, string[]>;

/** Provider id → the header its key travels in. */
const HEADER: Record<string, (key: string) => Record<string, string>> = {
  anthropic: (key) => ({ "x-api-key": key }),
  openai: (key) => ({ authorization: `Bearer ${key}` }),
  openrouter: (key) => ({ authorization: `Bearer ${key}` }),
  groq: (key) => ({ authorization: `Bearer ${key}` }),
  deepseek: (key) => ({ authorization: `Bearer ${key}` }),
  mistral: (key) => ({ authorization: `Bearer ${key}` }),
  together: (key) => ({ authorization: `Bearer ${key}` }),
  xai: (key) => ({ authorization: `Bearer ${key}` }),
};

export async function loadPools(home = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic")): Promise<KeyPools> {
  const path = join(home, "config.json");
  if (!existsSync(path)) return {};
  try {
    const cfg = JSON.parse(await readFile(path, "utf8")) as { keys?: unknown };
    if (!cfg.keys || typeof cfg.keys !== "object") return {};
    const out: KeyPools = {};
    for (const [provider, value] of Object.entries(cfg.keys as Record<string, unknown>)) {
      // A single string is a pool of one; accepting it avoids a footgun.
      const keys = (Array.isArray(value) ? value : [value]).filter((k): k is string => typeof k === "string" && !!k);
      if (keys.length) out[provider] = keys;
    }
    return out;
  } catch {
    return {};
  }
}

/** Round-robin selector. Keeps its own cursor per provider. */
export function makeRotator(pools: KeyPools) {
  const cursor = new Map<string, number>();
  return function next(provider: string): string | undefined {
    const keys = pools[provider];
    if (!keys?.length) return undefined;
    const i = cursor.get(provider) ?? 0;
    cursor.set(provider, (i + 1) % keys.length);
    return keys[i % keys.length];
  };
}

export function headersFor(provider: string, key: string): Record<string, string> {
  // Bearer is what most OpenAI-compatible endpoints expect, so it is the
  // sensible default for a provider not listed above.
  return (HEADER[provider] ?? ((k: string) => ({ authorization: `Bearer ${k}` })))(key);
}

export const KeyPoolPlugin: Plugin = async () => {
  const pools = await loadPools();
  if (!Object.keys(pools).length) return {};
  const next = makeRotator(pools);

  return {
    "chat.headers": async (input, output) => {
      const provider = (input.provider as unknown as { id?: string })?.id ?? input.model?.providerID;
      if (!provider) return;
      const key = next(provider);
      if (!key) return;
      Object.assign(output.headers, headersFor(provider, key));
    },
  };
};

export default KeyPoolPlugin;
