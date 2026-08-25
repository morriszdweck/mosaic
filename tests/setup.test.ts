import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, needsSetup } from "../src/setup/index.ts";
import { buildConfig } from "../src/config.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mosaic-setup-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("needsSetup", () => {
  test("true on a fresh install", async () => {
    expect(await needsSetup(home)).toBe(true);
  });

  test("false once a model is chosen", async () => {
    writeFileSync(configPath(home), JSON.stringify({ model: "anthropic/claude-sonnet-4-5" }));
    expect(await needsSetup(home)).toBe(false);
  });

  test("true when a config exists but names no model", async () => {
    writeFileSync(configPath(home), JSON.stringify({ instructions: ["x.md"] }));
    expect(await needsSetup(home)).toBe(true);
  });

  // Otherwise a corrupt file locks you out of the one screen that could fix it.
  test("true when the config cannot be parsed", async () => {
    writeFileSync(configPath(home), "{ broken");
    expect(await needsSetup(home)).toBe(true);
  });
});

describe("SOUL.md", () => {
  test("is not referenced when absent", () => {
    expect(buildConfig("/opt/mosaic", home).instructions).toEqual(["/opt/mosaic/prompts/mosaic.md"]);
  });

  test("is applied after Mosaic's own prompt, so the user's voice wins", () => {
    writeFileSync(join(home, "SOUL.md"), "Call me Morris. Be blunt.");
    const instructions = buildConfig("/opt/mosaic", home).instructions!;
    expect(instructions).toHaveLength(2);
    expect(instructions[0]).toContain("prompts/mosaic.md");
    expect(instructions[1]).toBe(join(home, "SOUL.md"));
  });
});

describe("written config", () => {
  test("a chosen model survives into the generated config", async () => {
    writeFileSync(configPath(home), JSON.stringify({ model: "groq/llama-3.3-70b-versatile" }));
    const cfg = JSON.parse(await readFile(configPath(home), "utf8")) as { model: string };
    expect(cfg.model).toBe("groq/llama-3.3-70b-versatile");
  });
});
