import * as readline from "node:readline/promises";
import {
  AuthStore,
  pollForToken,
  requestDeviceCode,
  type Credential,
} from "@mosaic/core";

/**
 * mosaic login — frictionless provider onboarding:
 *   codex:    OAuth device flow ("sign in with ChatGPT")
 *   opencode: paste an API key
 *   others:   paste a standard API key
 */

async function promptSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function loginCommand(provider: string | undefined, flags: { key?: string }): Promise<number> {
  const store = new AuthStore();
  const name = provider ?? "codex";

  if (name === "codex") {
    console.error("Starting ChatGPT device sign-in…");
    const device = await requestDeviceCode();
    console.error(`\n  Open: ${device.verificationUriComplete ?? device.verificationUri}`);
    if (!device.verificationUriComplete) console.error(`  Code: ${device.userCode}`);
    console.error("\nWaiting for approval… (Ctrl+C to cancel)");
    try {
      const credential = await pollForToken(device.deviceCode);
      await store.set("codex", credential);
      console.error("✓ Signed in. Credentials stored in ~/.mosaic/auth.json");
      return 0;
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  // Key-paste flows (opencode, or any standard provider).
  const key = flags.key ?? (await promptSecret(`Paste your ${name} API key: `));
  if (!key) {
    console.error("No key provided.");
    return 1;
  }
  const credential: Credential = { kind: "apikey", key };
  await store.set(name, credential);
  console.error(`✓ Stored ${name} API key in ~/.mosaic/auth.json (0600)`);
  return 0;
}

export async function logoutCommand(provider: string | undefined): Promise<number> {
  const store = new AuthStore();
  const name = provider ?? "codex";
  const removed = await store.remove(name);
  console.error(removed ? `✓ Removed ${name} credentials` : `No credentials stored for ${name}`);
  return removed ? 0 : 1;
}

export async function authStatusCommand(): Promise<number> {
  const store = new AuthStore();
  const providers = await store.list();
  if (!providers.length) {
    console.log("No stored credentials. Env-var keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, …) still work.");
    return 0;
  }
  console.log("Stored credentials:");
  for (const p of providers) {
    const cred = await store.get(p);
    const kind = cred?.kind === "oauth" ? "OAuth token" : "API key";
    console.log(`  ${p}: ${kind}`);
  }
  return 0;
}
