/**
 * Built-in provider presets.
 *
 * Mosaic is bring-your-own-key: you supply a key, we already know where to send
 * it. Everything here except Anthropic speaks the OpenAI chat-completions API,
 * so adding a provider is usually just a base URL and the env var its key
 * conventionally lives in.
 *
 * Nothing here is required — `[providers.<name>]` in config.toml can add an
 * endpoint we have never heard of, or override any field below.
 */

export interface ProviderPreset {
  /** Display name for menus and error messages. */
  label: string;
  /** OpenAI-compatible base URL. Anthropic uses its own wire format. */
  baseUrl: string;
  /** Env var the key conventionally lives in. */
  apiKeyEnv?: string;
  /** Local runtimes accept any key, so missing credentials are not an error. */
  keyless?: boolean;
  /** Uses the native Anthropic API rather than OpenAI chat-completions. */
  native?: "anthropic";
  /** Where to get a key — shown when one is missing. */
  keyUrl?: string;
  /** Example model, used by `mosaic providers` to show a runnable command. */
  exampleModel: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    exampleModel: "gpt-4o-mini",
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    native: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    exampleModel: "claude-sonnet-4-5",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys",
    exampleModel: "anthropic/claude-sonnet-4.5",
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    exampleModel: "llama-3.3-70b-versatile",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
    exampleModel: "deepseek-chat",
  },
  together: {
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    keyUrl: "https://api.together.ai/settings/api-keys",
    exampleModel: "Qwen/Qwen2.5-72B-Instruct-Turbo",
  },
  mistral: {
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys",
    exampleModel: "mistral-large-latest",
  },
  xai: {
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
    exampleModel: "grok-3",
  },
  fireworks: {
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyEnv: "FIREWORKS_API_KEY",
    keyUrl: "https://fireworks.ai/account/api-keys",
    exampleModel: "accounts/fireworks/models/qwen2p5-72b-instruct",
  },
  cerebras: {
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    keyUrl: "https://cloud.cerebras.ai",
    exampleModel: "llama-3.3-70b",
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    keyless: true,
    exampleModel: "llama3.1",
  },
  lmstudio: {
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    keyless: true,
    exampleModel: "local-model",
  },
};

/** Conventional env var for a provider we have no preset for. */
export function conventionalKeyEnv(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
