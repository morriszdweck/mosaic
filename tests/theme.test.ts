import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTuiConfig } from "../src/config.ts";

const theme = JSON.parse(readFileSync(join(import.meta.dir, "..", "themes", "mosaic.json"), "utf8")) as {
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
    expect(buildTuiConfig("/opt/mosaic").theme).toBe("mosaic");
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
  };
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

  test("is visibly darker than mosaic, not a near-copy", () => {
    const a = rgb(theme.defs.midnight!).reduce((x, y) => x + y);
    const b = rgb(dark.defs.midnight!).reduce((x, y) => x + y);
    // A variant nobody can tell apart is not a variant.
    expect(b).toBeLessThan(a * 0.75);
  });

  test("stays blue rather than desaturating to black", () => {
    // Dropping lightness by pulling every channel down turns navy into grey.
    for (const key of ["midnight", "deepBlue", "slateBlue", "steel"]) {
      const [r, g, b] = rgb(dark.defs[key]!);
      expect(b, `${key} blue vs red`).toBeGreaterThan(r + 10);
      expect(b, `${key} blue vs green`).toBeGreaterThan(g);
    }
  });

  test("its accent is lifted so it still reads against the deeper ground", () => {
    const lift = (hex: string) => rgb(hex).reduce((x, y) => x + y);
    expect(lift(dark.defs.sky!)).toBeGreaterThan(lift(theme.defs.sky!));
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
