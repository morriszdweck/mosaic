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
