import { resolveApiKey, type MosaicConfig } from "../config.ts";
import type { AuthStore } from "../auth/store.ts";
import type { ModelRef, Provider } from "../types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { CodexProvider, OpenCodeProvider } from "./codex.ts";
import { OpenAICompatibleProvider } from "./openai.ts";

/**
 * Provider registry. Model strings look like "provider:model"
 * (e.g. "anthropic:claude-sonnet-4-5", "openai:gpt-4o", "ollama:llama3.1").
 * A bare model name falls back to the provider prefix map, then OpenAI.
 */

const PREFIX_HINTS: Array<[RegExp, string]> = [
  [/^claude/i, "anthropic"],
  [/^gpt|^o[134]/i, "openai"],
  [/^llama|^qwen|^mistral|^phi/i, "ollama"],
];

export function parseModelRef(model: string): ModelRef {
  const idx = model.indexOf(":");
  if (idx > 0) return { provider: model.slice(0, idx), model: model.slice(idx + 1) };
  for (const [re, provider] of PREFIX_HINTS) {
    if (re.test(model)) return { provider, model };
  }
  return { provider: "openai", model };
}

export interface ProviderResolution {
  provider: Provider;
  ref: ModelRef;
  /** Human-readable auth hint when credentials are missing. */
  warning?: string;
}

export function resolveProvider(
  modelString: string,
  config: MosaicConfig,
  store: AuthStore,
  fetchFn?: typeof fetch,
): ProviderResolution {
  const ref = parseModelRef(modelString);
  const pcfg = config.providers[ref.provider];

  switch (ref.provider) {
    case "anthropic": {
      const apiKey = resolveApiKey(config, "anthropic");
      if (!apiKey) {
        return {
          provider: new AnthropicProvider({ apiKey: "", baseUrl: pcfg?.baseUrl, fetchFn }),
          ref,
          warning: "No Anthropic API key. Set ANTHROPIC_API_KEY or run `mosaic login anthropic`.",
        };
      }
      return { provider: new AnthropicProvider({ apiKey, baseUrl: pcfg?.baseUrl, fetchFn }), ref };
    }
    case "codex":
      return { provider: new CodexProvider({ store, baseUrl: pcfg?.baseUrl, fetchFn }), ref };
    case "opencode":
      return { provider: new OpenCodeProvider({ store, baseUrl: pcfg?.baseUrl, fetchFn }), ref };
    default: {
      // Any OpenAI-compatible endpoint: openai, openrouter, groq, ollama, lmstudio, custom.
      const apiKey = resolveApiKey(config, ref.provider);
      const baseUrl = pcfg?.baseUrl ?? "https://api.openai.com/v1";
      const headers: Record<string, string> = {};
      if (ref.provider === "openrouter") {
        headers["HTTP-Referer"] = "https://github.com/morriszdweck/mosaic";
        headers["X-Title"] = "Mosaic";
      }
      const needsKey = !["ollama", "lmstudio"].includes(ref.provider);
      return {
        provider: new OpenAICompatibleProvider({ name: ref.provider, baseUrl, apiKey, headers, fetchFn }),
        ref,
        warning:
          needsKey && !apiKey
            ? `No API key for ${ref.provider}. Set ${pcfg?.apiKeyEnv ?? `${ref.provider.toUpperCase()}_API_KEY`} or run \`mosaic login ${ref.provider}\`.`
            : undefined,
      };
    }
  }
}
