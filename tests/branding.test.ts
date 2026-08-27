import { describe, expect, test } from "bun:test";
import { buildTuiConfig } from "../src/config.ts";
import { PLACEHOLDERS, SPLASH_TEXT, WORDMARK } from "../src/plugin/branding/index.tsx";

describe("built-in tui branding", () => {
  // Branding renders into TUI slots, so it has to be registered in tui.json or
  // it is accepted without error and simply never drawn.
  test("registers branding in the TUI config, not the agent config", () => {
    expect(buildTuiConfig("/opt/mosaic").plugin).toEqual(["/opt/mosaic/src/plugin/branding/index.tsx"]);
  });

  test("keeps the built-in branding path when user config tries to replace it", async () => {
    const { mergeTuiConfig } = await import("../src/config.ts");
    const generated = buildTuiConfig("/opt/mosaic");
    const merged = mergeTuiConfig(generated, { plugin: [] });
    expect(merged.plugin).toEqual(generated.plugin);
  });

  test("preserves native TUI plugins alongside built-in branding", async () => {
    const { mergeTuiConfig } = await import("../src/config.ts");
    const merged = mergeTuiConfig(buildTuiConfig("/opt/mosaic"), {
      plugin: ["/opt/plugins/example.tsx", "/old/install/branding.tsx"],
    });
    expect(merged.plugin).toEqual([
      "/opt/mosaic/src/plugin/branding/index.tsx",
      "/opt/plugins/example.tsx",
    ]);
  });

  test("does not let user config disable built-in branding", async () => {
    const { mergeTuiConfig } = await import("../src/config.ts");
    const merged = mergeTuiConfig(buildTuiConfig("/opt/mosaic"), {
      plugin_enabled: { "mosaic-branding": false, "another-plugin": false },
    });
    expect(merged.plugin_enabled).toEqual({ "another-plugin": false });
  });
});

describe("wordmark", () => {
  test("every line is the same width, or the block renders ragged", () => {
    const widths = new Set(WORDMARK.map((l) => [...l].length));
    expect(widths.size).toBe(1);
  });

  test("says mosaic, not the engine's name", () => {
    expect(SPLASH_TEXT).toBe("mosaic");
  });

  test("uses a large wordmark rather than a one-line label", () => {
    expect(WORDMARK).toHaveLength(3);
    expect(WORDMARK[0]!.length).toBeGreaterThan(SPLASH_TEXT.length);
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
