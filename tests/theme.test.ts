import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTuiConfig } from "../src/config.ts";

const theme = JSON.parse(readFileSync(join(import.meta.dir, "..", "themes", "mosaic-light.json"), "utf8")) as {
  defs: Record<string, string>;
  theme: Record<string, string | { dark: string; light: string }>;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Every value is either a hex literal or the name of a def. */
function resolve(value: string): string | null {
  if (HEX.test(value)) return value;
  return theme.defs[value] ?? null;
}

describe("mosaic theme", () => {
  test("is the default, replacing the engine's own", () => {
    // The engine's built-in default is "opencode".
    expect(buildTuiConfig("/opt/mosaic").theme).toBe("mosaic-light");
  });

  test("every def is a valid hex colour", () => {
    for (const [name, value] of Object.entries(theme.defs)) {
      expect(HEX.test(value), `${name} = ${value}`).toBe(true);
    }
  });

  // A typo'd def name resolves to nothing and the colour silently disappears,
  // which is very hard to spot by eye across ~50 keys.
  test("every reference resolves to a real colour", () => {
    for (const [key, value] of Object.entries(theme.theme)) {
      const variants = typeof value === "string" ? [value] : [value.dark, value.light];
      for (const variant of variants) {
        expect(resolve(variant), `${key} → ${variant}`).not.toBeNull();
      }
    }
  });

  test("covers both light and dark", () => {
    for (const [key, value] of Object.entries(theme.theme)) {
      expect(typeof value === "object" && "dark" in value && "light" in value, key).toBe(true);
    }
  });

  test("carries the keys the interface actually reads", () => {
    for (const key of [
      "primary",
      "text",
      "textMuted",
      "background",
      "backgroundPanel",
      "border",
      "borderActive",
      "error",
      "warning",
      "success",
    ]) {
      expect(theme.theme, key).toHaveProperty(key);
    }
  });

  test("is blue: the primary, accent and background all sit in the blue range", () => {
    for (const key of ["primary", "accent", "background", "backgroundPanel"]) {
      const dark = resolve((theme.theme[key] as { dark: string }).dark)!;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16)) as [number, number, number];
      expect(b, `${key} = ${dark}`).toBeGreaterThanOrEqual(r);
      expect(b, `${key} = ${dark}`).toBeGreaterThanOrEqual(g);
    }
  });

  test("text stays readable against the background", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    for (const mode of ["dark", "light"] as const) {
      const bg = lum(resolve((theme.theme.background as Record<string, string>)[mode]!)!);
      const fg = lum(resolve((theme.theme.text as Record<string, string>)[mode]!)!);
      const contrast = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
      expect(contrast, `${mode} text on background`).toBeGreaterThan(7);
    }
  });
});

describe("mosaic-dark", () => {
  const dark = JSON.parse(readFileSync(join(import.meta.dir, "..", "themes", "mosaic-dark.json"), "utf8")) as {
    defs: Record<string, string>;
    theme: Record<string, string | { dark: string; light: string }>;
  };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const resolve = (value: string): string | null => (HEX.test(value) ? value : (dark.defs[value] ?? null));

  test("is Night Owl: the palette's signature colours are pinned", () => {
    // The old navy variant was retired in favour of Night Owl; pin its ground
    // and accent so a stray edit cannot silently undo the rename.
    expect(dark.defs.nightOwlBg).toBe("#011627");
    expect(dark.defs.nightOwlFg).toBe("#d6deeb");
    expect(dark.defs.nightOwlPurple).toBe("#c792ea");
    expect(dark.defs.nightOwlBlue).toBe("#82AAFF");
  });

  test("every reference resolves to a real colour", () => {
    for (const [key, value] of Object.entries(dark.theme)) {
      const variants = typeof value === "string" ? [value] : [value.dark, value.light];
      for (const variant of variants) {
        expect(resolve(variant), `${key} → ${variant}`).not.toBeNull();
      }
    }
  });

  test("text stays readable against the background", () => {
    const bg = resolve((dark.theme.background as { dark: string }).dark)!;
    const fg = resolve((dark.theme.text as { dark: string }).dark)!;
    const contrast = (Math.max(lum(bg), lum(fg)) + 0.05) / (Math.min(lum(bg), lum(fg)) + 0.05);
    expect(contrast).toBeGreaterThan(7);
  });
});

describe("tui config", () => {
  test("a theme the user picked survives the next launch", async () => {
    const { mergeTuiConfig, buildTuiConfig } = await import("../src/config.ts");
    // The launcher rewrites tui.json every start so the plugin path stays
    // current. Writing it wholesale reverted /theme on every relaunch, which
    // reads as the theme simply not working.
    const merged = mergeTuiConfig(buildTuiConfig("/opt/mosaic"), { theme: "mosaic-dark" });
    expect(merged.theme).toBe("mosaic-dark");
  });

  test("but the plugin path is always refreshed", async () => {
    const { mergeTuiConfig, buildTuiConfig } = await import("../src/config.ts");
    // A stale absolute path from an older install location breaks branding.
    const merged = mergeTuiConfig(buildTuiConfig("/opt/mosaic"), { plugin: ["/old/install/branding.tsx"] });
    expect(merged.plugin).toEqual(["/opt/mosaic/src/plugin/branding/index.tsx"]);
  });

  test("other settings the user added are kept", async () => {
    const { mergeTuiConfig, buildTuiConfig } = await import("../src/config.ts");
    const merged = mergeTuiConfig(buildTuiConfig("/opt/mosaic"), { keybinds: { leader: "ctrl+a" } });
    expect(merged.keybinds).toEqual({ leader: "ctrl+a" });
  });

  test("an unreadable file falls back to defaults instead of wiping settings", async () => {
    const { readTuiConfig } = await import("../src/config.ts");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "mosaic-tui-"));
    const path = join(dir, "tui.json");
    writeFileSync(path, "{ broken");
    expect(await readTuiConfig(path)).toEqual({});
  });
});
