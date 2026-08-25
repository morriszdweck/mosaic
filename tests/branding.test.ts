import { describe, expect, test } from "bun:test";
import { buildTuiConfig } from "../src/config.ts";
import { PLACEHOLDERS, WORDMARK } from "../src/plugin/branding/index.tsx";

describe("tui config", () => {
  // Plugins listed in the agent config only get their `server` half loaded.
  // Branding renders into TUI slots, so it has to be registered in tui.json or
  // it is accepted without error and simply never drawn.
  test("registers branding in the TUI config, not the agent config", () => {
    expect(buildTuiConfig("/opt/mosaic").plugin).toEqual(["/opt/mosaic/src/plugin/branding/index.tsx"]);
  });
});

describe("wordmark", () => {
  test("every line is the same width, or the block renders ragged", () => {
    const widths = new Set(WORDMARK.map((l) => [...l].length));
    expect(widths.size).toBe(1);
  });

  test("says Mosaic, not the engine's name", () => {
    expect(WORDMARK.join("").toLowerCase()).not.toContain("opencode");
  });
});

describe("placeholders", () => {
  test("are not all about code — the home screen is where a user decides what this is for", () => {
    const codey = PLACEHOLDERS.filter((p) => /\b(test|bug|refactor|compile|lint|commit)\b/i.test(p));
    expect(codey.length).toBeLessThan(PLACEHOLDERS.length / 2);
  });

  test("cover research, writing, and analysis", () => {
    const joined = PLACEHOLDERS.join(" ").toLowerCase();
    expect(joined).toContain("summarise");
    expect(joined).toContain("draft");
    expect(joined).toMatch(/csv|measuring|data/);
  });
});

describe("replaced interface plugins", () => {
  test("names the built-ins Mosaic takes over from", async () => {
    const src = await Bun.file(new URL("../src/plugin/branding/index.tsx", import.meta.url)).text();
    // These render "• OpenCode <version>" and a tip about connecting a provider
    // "to start coding". Neither is reachable through a slot — the host
    // registers them append-only — so they are deactivated instead.
    expect(src).toContain("internal:home-footer");
    expect(src).toContain("internal:home-tips");
    expect(src).toContain("api.plugins.deactivate");
  });

  test("a missing built-in does not break the rest of the branding", async () => {
    const src = await Bun.file(new URL("../src/plugin/branding/index.tsx", import.meta.url)).text();
    // An id that disappears upstream must not take Mosaic's wordmark with it.
    expect(src).toMatch(/deactivate\([^)]*\)\.catch/);
  });

  test("tips describe Mosaic's own features, not coding", async () => {
    const { TIPS } = (await import("../src/plugin/branding/index.tsx")) as unknown as { TIPS: string[] };
    expect(TIPS.length).toBeGreaterThan(3);
    for (const tip of TIPS) expect(tip.toLowerCase()).not.toContain("coding");
  });
});
