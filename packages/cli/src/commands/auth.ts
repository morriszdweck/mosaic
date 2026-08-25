import * as readline from "node:readline/promises";
import {
  AuthStore,
  keyEnvFor,
  loadConfig,
  PROVIDER_PRESETS,
  resolveApiKey,
  type Credential,
} from "@mosaic/core";

/**
 * mosaic login — bring your own key.
 *
 * Every provider is a base URL plus a key, so onboarding is one command:
 *   mosaic login openai --key sk-…
 *   mosaic login            (prompts for provider and key)
 *
 * Keys land in ~/.mosaic/auth.json at 0600. Env vars keep working and take
 * precedence, so CI and one-off shells need no login at all.
 */

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function knownProviderList(): string {
  return Object.entries(PROVIDER_PRESETS)
    .map(([name, p]) => `  ${name.padEnd(12)} ${p.label}${p.keyless ? " — no key needed" : ""}`)
    .join("\n");
}

export async function loginCommand(provider: string | undefined, flags: { key?: string }): Promise<number> {
  const store = new AuthStore();

  const name = provider ?? (await prompt(`Provider?\n${knownProviderList()}\n\nName: `));
  if (!name) {
    console.error("No provider given.");
    return 1;
  }

  const preset = PROVIDER_PRESETS[name];
  if (preset?.keyless) {
    console.error(`${preset.label} runs locally and needs no key — just use \`${name}:${preset.exampleModel}\`.`);
    return 0;
  }
  if (!preset) {
    // Not fatal: a custom endpoint in config.toml is a first-class setup.
    console.error(`Note: "${name}" is not a built-in provider. Set its base_url in ~/.mosaic/config.toml:`);
    console.error(`  [providers.${name}]\n  base_url = "https://…/v1"`);
  }

  if (preset?.keyUrl && !flags.key) console.error(`Get a key at ${preset.keyUrl}`);
  const key = flags.key ?? (await prompt(`Paste your ${preset?.label ?? name} API key: `));
  if (!key) {
    console.error("No key provided.");
    return 1;
  }

  const credential: Credential = { kind: "apikey", key };
  await store.set(name, credential);
  console.error(`✓ Stored ${preset?.label ?? name} key in ~/.mosaic/auth.json (0600)`);
  console.error(`  Try: mosaic --model ${name}:${preset?.exampleModel ?? "<model>"}`);
  return 0;
}

export async function logoutCommand(provider: string | undefined): Promise<number> {
  const store = new AuthStore();
  const name = provider ?? (await prompt("Provider to sign out: "));
  if (!name) {
    console.error("No provider given.");
    return 1;
  }
  const removed = await store.remove(name);
  console.error(removed ? `✓ Removed ${name} credentials` : `No credentials stored for ${name}`);
  return removed ? 0 : 1;
}

/**
 * Show where each provider's key is actually coming from. Env beats a saved
 * key, so "stored" alone would be misleading when a variable is shadowing it.
 */
export async function authStatusCommand(): Promise<number> {
  const store = new AuthStore();
  const config = await loadConfig();
  config.storedKeys = await store.apiKeys();

  const names = new Set([...Object.keys(PROVIDER_PRESETS), ...(await store.list())]);
  const rows: string[] = [];

  for (const name of [...names].sort()) {
    const preset = PROVIDER_PRESETS[name];
    if (preset?.keyless) {
      rows.push(`  ${name.padEnd(12)} local — no key needed`);
      continue;
    }
    const env = keyEnvFor(config, name);
    const stored = config.storedKeys[name];
    if (process.env[env]) rows.push(`  ${name.padEnd(12)} ✓ ${env}${stored ? " (shadowing saved key)" : ""}`);
    else if (config.providers[name]?.apiKey) rows.push(`  ${name.padEnd(12)} ✓ config.toml`);
    else if (stored) rows.push(`  ${name.padEnd(12)} ✓ saved login`);
    else rows.push(`  ${name.padEnd(12)} — set ${env} or run \`mosaic login ${name}\``);
  }

  console.log("Providers:");
  console.log(rows.join("\n"));

  const ready = [...names].filter((n) => PROVIDER_PRESETS[n]?.keyless || resolveApiKey(config, n));
  if (!ready.length) console.log("\nNo providers configured yet. Run `mosaic login` to add one.");
  return 0;
}

/** `mosaic providers` — the catalogue, with a runnable example per entry. */
export async function providersCommand(): Promise<number> {
  const config = await loadConfig();
  config.storedKeys = await new AuthStore().apiKeys();

  console.log("Built-in providers (any OpenAI-compatible endpoint also works):\n");
  for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
    const ready = preset.keyless || resolveApiKey(config, name);
    console.log(`  ${ready ? "✓" : " "} ${name.padEnd(12)} ${preset.label}`);
    console.log(`      mosaic --model ${name}:${preset.exampleModel}`);
  }
  console.log("\nAdd your own in ~/.mosaic/config.toml:");
  console.log('  [providers.myhost]\n  base_url = "https://my-endpoint/v1"\n  api_key_env = "MYHOST_API_KEY"');
  return 0;
}
