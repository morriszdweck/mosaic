import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, keyEnvFor, resolveApiKey } from "../src/config.ts";
import { PROVIDER_PRESETS } from "../src/providers/presets.ts";
import { parseModelRef, resolveProvider } from "../src/providers/registry.ts";

function config() {
  return structuredClone(DEFAULT_CONFIG);
}

const touched: string[] = [];
function setEnv(name: string, value: string) {
  touched.push(name);
  process.env[name] = value;
}
afterEach(() => {
  for (const n of touched.splice(0)) delete process.env[n];
});

describe("key resolution", () => {
  test("reads a key saved by `mosaic login --key`", () => {
    const cfg = config();
    cfg.storedKeys.openai = "sk-saved";
    // Regression: nothing read the auth store back, so saved keys did nothing
    // and only env vars ever worked.
    expect(resolveApiKey(cfg, "openai")).toBe("sk-saved");
  });

  test("env var wins over a saved key", () => {
    const cfg = config();
    cfg.storedKeys.openai = "sk-saved";
    setEnv("OPENAI_API_KEY", "sk-env");
    expect(resolveApiKey(cfg, "openai")).toBe("sk-env");
  });

  test("config.toml key wins over both", () => {
    const cfg = config();
    cfg.providers.openai = { ...cfg.providers.openai, apiKey: "sk-cfg" };
    cfg.storedKeys.openai = "sk-saved";
    setEnv("OPENAI_API_KEY", "sk-env");
    expect(resolveApiKey(cfg, "openai")).toBe("sk-cfg");
  });

  test("falls back to the NAME_API_KEY convention for an unconfigured provider", () => {
    const cfg = config();
    delete cfg.providers.custom;
    setEnv("CUSTOM_API_KEY", "sk-custom");
    // Regression: this returned undefined while the error text told you to set
    // exactly this variable.
    expect(keyEnvFor(cfg, "custom")).toBe("CUSTOM_API_KEY");
    expect(resolveApiKey(cfg, "custom")).toBe("sk-custom");
  });

  test("hyphenated provider names map to a legal env var", () => {
    expect(keyEnvFor(config(), "my-host.ai")).toBe("MY_HOST_AI_API_KEY");
  });
});

describe("provider resolution", () => {
  test("every preset resolves to its own endpoint", () => {
    const cfg = config();
    for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
      setEnv(keyEnvFor(cfg, name), "sk-x");
      const { provider } = resolveProvider(`${name}:${preset.exampleModel}`, cfg);
      expect((provider as unknown as { baseUrl: string }).baseUrl).toBe(preset.baseUrl);
    }
  });

  test("an unknown provider is refused, not silently sent to OpenAI", () => {
    const cfg = config();
    setEnv("OPENAI_API_KEY", "sk-openai");
    const { warning } = resolveProvider("totally-made-up:some-model", cfg);
    // Previously this fell through to api.openai.com, leaking the prompt and
    // the OpenAI key to a provider the user never named.
    expect(warning).toContain("Unknown provider");
    expect(warning).toContain("base_url");
  });

  test("a custom endpoint from config.toml is accepted", () => {
    const cfg = config();
    cfg.providers.myhost = { baseUrl: "https://my-endpoint/v1", apiKeyEnv: "MYHOST_API_KEY" };
    setEnv("MYHOST_API_KEY", "sk-my");
    const { provider, warning } = resolveProvider("myhost:some-model", cfg);
    expect(warning).toBeUndefined();
    expect((provider as unknown as { baseUrl: string }).baseUrl).toBe("https://my-endpoint/v1");
  });

  test("local runtimes need no key", () => {
    expect(resolveProvider("ollama:llama3.1", config()).warning).toBeUndefined();
    expect(resolveProvider("lmstudio:local-model", config()).warning).toBeUndefined();
  });

  test("a missing key names the variable and where to get one", () => {
    const { warning } = resolveProvider("groq:llama-3.3-70b-versatile", config());
    expect(warning).toContain("GROQ_API_KEY");
    expect(warning).toContain("console.groq.com");
  });

  test("bare model names route to the expected provider", () => {
    expect(parseModelRef("grok-3").provider).toBe("xai");
    expect(parseModelRef("deepseek-chat").provider).toBe("deepseek");
    expect(parseModelRef("claude-sonnet-4-5").provider).toBe("anthropic");
    expect(parseModelRef("gpt-4o").provider).toBe("openai");
  });
});
