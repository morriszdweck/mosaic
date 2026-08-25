import { keyEnvFor, resolveApiKey, type MosaicConfig } from "../config.ts";
import type { ModelRef, Provider } from "../types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatibleProvider } from "./openai.ts";
import { PROVIDER_PRESETS } from "./presets.ts";

/**
 * Provider registry. Model strings look like "provider:model"
 * (e.g. "anthropic:claude-sonnet-4-5", "openai:gpt-4o", "ollama:llama3.1").
 * A bare model name falls back to the provider prefix map, then OpenAI.
 */

const PREFIX_HINTS: Array<[RegExp, string]> = [
  [/^claude/i, "anthropic"],
  [/^gpt|^o[134]/i, "openai"],
  [/^grok/i, "xai"],
  [/^deepseek/i, "deepseek"],
  // mistral/llama/qwen/phi stay on the local runtime: these names are the
  // open-weight families you actually run under Ollama. Use "mistral:<model>"
  // explicitly for the hosted API.
  [/^llama|^qwen|^mistral|^phi|^gemma/i, "ollama"],
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
  /** Human-readable auth hint when credentials are missing or misconfigured. */
  warning?: string;
}

/** "No API key for X. Set VAR, or run `mosaic login X`. Get one at: url" */
function missingKeyWarning(cfg: MosaicConfig, provider: string): string {
  const label = PROVIDER_PRESETS[provider]?.label ?? provider;
  const keyUrl = PROVIDER_PRESETS[provider]?.keyUrl;
  return (
    `No API key for ${label}. Set ${keyEnvFor(cfg, provider)} or run \`mosaic login ${provider} --key <key>\`.` +
    (keyUrl ? ` Get one at ${keyUrl}` : "")
  );
}

export function resolveProvider(
  modelString: string,
  config: MosaicConfig,
  fetchFn?: typeof fetch,
): ProviderResolution {
  const ref = parseModelRef(modelString);
  const pcfg = config.providers[ref.provider];
  const preset = PROVIDER_PRESETS[ref.provider];
  const apiKey = resolveApiKey(config, ref.provider);

  if (preset?.native === "anthropic") {
    const baseUrl = pcfg?.baseUrl ?? preset.baseUrl;
    return {
      provider: new AnthropicProvider({ apiKey: apiKey ?? "", baseUrl, fetchFn }),
      ref,
      warning: apiKey ? undefined : missingKeyWarning(config, ref.provider),
    };
  }

  // Everything else speaks OpenAI chat-completions.
  const baseUrl = pcfg?.baseUrl ?? preset?.baseUrl;
  if (!baseUrl) {
    // Previously this silently fell back to api.openai.com, so a typo'd or
    // unknown provider sent your prompt (and your OpenAI key) to OpenAI under a
    // model name it does not have. Refuse instead and say how to register it.
    return {
      provider: new OpenAICompatibleProvider({ name: ref.provider, baseUrl: "", apiKey, fetchFn }),
      ref,
      warning:
        `Unknown provider "${ref.provider}". Add it to config.toml:\n` +
        `  [providers.${ref.provider}]\n  base_url = "https://…/v1"\n` +
        `Known: ${Object.keys(PROVIDER_PRESETS).join(", ")}`,
    };
  }

  const headers: Record<string, string> = {};
  if (ref.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/morriszdweck/mosaic";
    headers["X-Title"] = "Mosaic";
  }

  const needsKey = !preset?.keyless;
  return {
    provider: new OpenAICompatibleProvider({ name: ref.provider, baseUrl, apiKey, headers, fetchFn }),
    ref,
    warning: needsKey && !apiKey ? missingKeyWarning(config, ref.provider) : undefined,
  };
}
