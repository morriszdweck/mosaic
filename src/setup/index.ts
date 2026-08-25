/**
 * First-launch setup.
 *
 * Runs once, before the TUI, when Mosaic has no model configured. The goal is
 * that someone with no API key and no account can still get a working agent in
 * one keypress, and that someone who does have a key is not made to click
 * through a tour to use it.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";

const MOSAIC_HOME = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");

/**
 * Providers offered during setup. Deliberately short: a wall of thirty
 * providers is not a choice, it is a quiz. Anything else is reachable
 * afterwards through `mosaic providers login`.
 */
const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic",
    model: "anthropic/claude-sonnet-4-5",
    // Titles, summaries and compaction do not need the expensive model, and
    // they run constantly. Pairing a cheap one is the single biggest saving
    // available at setup time.
    smallModel: "anthropic/claude-haiku-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    model: "openai/gpt-4o",
    smallModel: "openai/gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    model: "openrouter/anthropic/claude-sonnet-4.5",
    smallModel: "openrouter/anthropic/claude-haiku-4.5",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    label: "Groq",
    model: "groq/llama-3.3-70b-versatile",
    smallModel: "groq/llama-3.1-8b-instant",
    keyUrl: "https://console.groq.com/keys",
  },
] as const;

/** The free model Mosaic ships as its default. Shown as "Mosaic Free". */
const ZEN_FREE_MODEL = "opencode/big-pickle";

export interface SetupResult {
  model?: string;
  /** True when the user chose a provider they still have to log into. */
  needsLogin?: string;
}

export function configPath(home = MOSAIC_HOME): string {
  return join(home, "config.json");
}

/** Setup is needed until a model has been chosen. */
export async function needsSetup(home = MOSAIC_HOME): Promise<boolean> {
  const path = configPath(home);
  if (!existsSync(path)) return true;
  try {
    const cfg = JSON.parse(await readFile(path, "utf8")) as { model?: string };
    return !cfg.model;
  } catch {
    return true;
  }
}

async function writeChoice(model: string, home = MOSAIC_HOME, smallModel?: string): Promise<void> {
  await mkdir(home, { recursive: true });
  const path = configPath(home);
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    } catch {
      // Overwrite an unreadable file rather than refusing to finish setup.
    }
  }
  const next: Record<string, unknown> = { ...existing, model };
  if (smallModel) next.small_model = smallModel;
  await writeFile(path, JSON.stringify(next, null, 2) + "\n");
}

const BANNER = `
  ███╗   ███╗ ██████╗ ███████╗ █████╗ ██╗ ██████╗
  ████╗ ████║██╔═══██╗██╔════╝██╔══██╗██║██╔════╝
  ██╔████╔██║██║   ██║███████╗███████║██║██║
  ██║╚██╔╝██║██║   ██║╚════██║██╔══██║██║██║
  ██║ ╚═╝ ██║╚██████╔╝███████║██║  ██║██║╚██████╗
  ╚═╝     ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝ ╚═════╝

  Think in pieces. Act as one.
`;

export async function runSetup(home = MOSAIC_HOME): Promise<SetupResult> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  try {
    process.stderr.write(BANNER);
    process.stderr.write("\n  Pick a model to start with.\n\n");
    process.stderr.write("    1  Free — no account, no card, works right now\n");
    PROVIDERS.forEach((p, i) => {
      process.stderr.write(`    ${i + 2}  ${p.label}${" ".repeat(Math.max(0, 12 - p.label.length))}bring your own API key\n`);
    });
    process.stderr.write("    s  Skip — I'll configure it myself\n\n");

    const answer = (await rl.question("  Choice [1]: ")).trim().toLowerCase() || "1";

    if (answer === "s" || answer === "skip") {
      process.stderr.write("\n  Skipped. Set a model with `mosaic providers login`, or edit\n");
      process.stderr.write(`  ${configPath(home)}\n\n`);
      return {};
    }

    if (answer === "1") {
      // Free models are a real on-ramp, but they are someone else's compute and
      // several of them train on what you send. Saying so here is the only
      // honest place — after this the model is just a name in a status bar.
      process.stderr.write("\n  Free models are provided by OpenCode Zen, and Mosaic is built on\n");
      process.stderr.write("  OpenCode's engine. Two things worth knowing:\n\n");
      process.stderr.write("    · Some free models train on your prompts and completions.\n");
      process.stderr.write("      Don't send anything confidential.\n");
      process.stderr.write("    · Availability varies — they are free, not guaranteed.\n\n");
      const ok = (await rl.question("  Continue with a free model? [Y/n]: ")).trim().toLowerCase();
      if (ok === "n" || ok === "no") return runSetup(home);

      // Same model for background work: the free models are all free, so there
      // is nothing to save by picking a different one, and the engine's own
      // default can be the slow one.
      await writeChoice(ZEN_FREE_MODEL, home, ZEN_FREE_MODEL);
      process.stderr.write("\n  ✓ Using Mosaic Free\n");
      process.stderr.write("    Switch any time with /model, or add your own key with\n");
      process.stderr.write("    `mosaic providers login`.\n\n");
      return { model: ZEN_FREE_MODEL };
    }

    const picked = PROVIDERS[Number(answer) - 2];
    if (!picked) {
      process.stderr.write("\n  Didn't catch that.\n");
      return runSetup(home);
    }

    await writeChoice(picked.model, home, picked.smallModel);
    process.stderr.write(`\n  ✓ ${picked.label} — ${picked.model}\n`);
    process.stderr.write(`    background work uses ${picked.smallModel}\n\n`);
    process.stderr.write(`  Add your key (get one at ${picked.keyUrl}):\n`);
    process.stderr.write(`    mosaic providers login\n\n`);
    return { model: picked.model, needsLogin: picked.id };
  } finally {
    rl.close();
  }
}

if (import.meta.main) {
  // Only meaningful on a terminal; a piped or scripted run must not block.
  if (!process.stdin.isTTY) process.exit(0);
  if (!(await needsSetup())) process.exit(0);
  await runSetup();
}
