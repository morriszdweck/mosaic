import { describe, expect, test } from "bun:test";
import { buildConfig } from "../src/config.ts";
import { AGENTS } from "../src/agents.ts";

const config = buildConfig("/opt/mosaic", "/home/u/.mosaic");

describe("config keys", () => {
  // The engine drops unknown keys silently instead of rejecting them, so a
  // plural key here would cost the agents and the memory plugin with no error.
  test("uses the engine's singular key names", () => {
    expect(config.agent).toBeDefined();
    expect(config.plugin).toBeDefined();
    expect(config).not.toHaveProperty("agents");
    expect(config).not.toHaveProperty("plugins");
  });

  test("mosaic is the default agent", () => {
    expect(config.default_agent).toBe("mosaic");
    expect(config.agent).toHaveProperty("mosaic");
  });

  test("paths are absolute, since the config is read from $MOSAIC_HOME", () => {
    for (const p of [...(config.instructions ?? []), ...(config.plugin ?? [])]) {
      const path = typeof p === "string" ? p : p[0];
      expect(path.startsWith("/")).toBe(true);
    }
  });

  test("points at this install's prompt and plugin", () => {
    expect(config.instructions).toContain("/opt/mosaic/prompts/mosaic.md");
    expect(config.plugin?.[0]).toBe("/opt/mosaic/src/plugin/memory/index.ts");
  });

  test("does not set skills — the engine discovers those itself", () => {
    // An array here fails the engine's schema and blocks startup entirely.
    expect(config).not.toHaveProperty("skills");
  });

  test("does not install the old agent-explainer plugins command", () => {
    expect(config.command).not.toHaveProperty("plugins");
  });

  test("keeps native plugin options available to user config", async () => {
    const { mergeConfig } = await import("../src/config.ts");
    const merged = mergeConfig(
      { plugin: [] },
      { plugin: [["opencode-example-plugin", { enabled: true }]] },
    );
    expect(merged.plugin).toEqual([["opencode-example-plugin", { enabled: true }]]);
  });
});

describe("defaults", () => {
  test("sharing is off — a general assistant should not publish conversations", () => {
    expect(config.share).toBe("disabled");
  });

  test("engine autoupdate is off, since updates come through Mosaic's release", () => {
    expect(config.autoupdate).toBe(false);
  });
});

describe("agents", () => {
  test("exactly one primary agent", () => {
    const primary = Object.entries(AGENTS).filter(([, a]) => a.mode === "primary");
    expect(primary.map(([name]) => name)).toEqual(["mosaic"]);
  });

  test("ships the general-purpose subagents", () => {
    expect(Object.keys(AGENTS).sort()).toEqual(["analyst", "build", "builder", "mosaic", "writer"]);
  });

  // `build` is a coding primary that competes with `mosaic` for the default
  // slot and frames the tool as a code editor.
  test("the engine's build agent is disabled", () => {
    expect(AGENTS.build!.disable).toBe(true);
  });

  test("no agent name states a trade the role is not limited to", () => {
    // `coder`/`uiux-designer` read as a coding tool; `builder`/`designer` do not.
    for (const name of Object.keys(AGENTS)) {
      expect(["coder", "uiux-designer", "research"]).not.toContain(name);
    }
  });

  test("every enabled agent has a description and a system prompt", () => {
    for (const [name, agent] of Object.entries(AGENTS)) {
      expect(agent.description, name).toBeTruthy();
      if (!agent.disable) expect(agent.system, name).toBeTruthy();
    }
  });

  test("the primary prompt frames the agent as general-purpose, not a coding tool", () => {
    expect(AGENTS.mosaic!.system).toContain("not limited to programming");
  });
});

describe("project config isolation", () => {
  test("mosaic looks for its own filenames, never the engine's", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadProjectConfig } = await import("../src/config.ts");

    const dir = mkdtempSync(join(tmpdir(), "mosaic-proj-"));
    // An OpenCode user's config sitting on the path to their work is exactly
    // how their providers leaked into Mosaic.
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "leaked/model" }));
    expect(await loadProjectConfig(dir)).toBeNull();

    writeFileSync(join(dir, "mosaic.json"), JSON.stringify({ model: "mine/model" }));
    expect((await loadProjectConfig(dir))?.model).toBe("mine/model");

    // .mosaic/config.json is the more specific location and wins.
    mkdirSync(join(dir, ".mosaic"), { recursive: true });
    writeFileSync(join(dir, ".mosaic", "config.json"), JSON.stringify({ model: "specific/model" }));
    expect((await loadProjectConfig(dir))?.model).toBe("specific/model");
  });

  test("walks up to find a parent project config", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadProjectConfig } = await import("../src/config.ts");

    const root = mkdtempSync(join(tmpdir(), "mosaic-walk-"));
    writeFileSync(join(root, "mosaic.json"), JSON.stringify({ model: "root/model" }));
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect((await loadProjectConfig(deep))?.model).toBe("root/model");
  });

  test("malformed project config is ignored rather than fatal", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadProjectConfig } = await import("../src/config.ts");

    const dir = mkdtempSync(join(tmpdir(), "mosaic-bad-"));
    writeFileSync(join(dir, "mosaic.json"), "{ not json");
    expect(await loadProjectConfig(dir)).toBeNull();
  });
});

describe("merge", () => {
  test("arrays extend and agents merge, so overrides add rather than replace", async () => {
    const { mergeConfig } = await import("../src/config.ts");
    const merged = mergeConfig(
      { instructions: ["a"], plugin: ["p1"], agent: { mosaic: { model: "x" } } },
      { instructions: ["b"], plugin: ["p2"], agent: { extra: { model: "y" } } },
    );
    expect(merged.instructions).toEqual(["a", "b"]);
    expect(merged.plugin).toEqual(["p1", "p2"]);
    expect(Object.keys(merged.agent!).sort()).toEqual(["extra", "mosaic"]);
  });
});

describe("display names", () => {
  test("the free provider keeps OC Zen visible in its label", () => {
    const zen = buildConfig("/opt/mosaic", "/home/u/.mosaic").provider!.opencode as { name: string };
    // Renaming is presentation; whose inference it is should stay legible.
    expect(zen.name).toBe("Free (via OC Zen)");
    expect(zen.name).toContain("OC Zen");
  });

  test("big-pickle is shown as Mosaic Free", () => {
    const zen = buildConfig("/opt/mosaic", "/home/u/.mosaic").provider!.opencode as {
      models: Record<string, { name: string }>;
    };
    expect(zen.models["big-pickle"]!.name).toBe("Mosaic Free");
  });

  test("the default model is the one shown as Mosaic Free", async () => {
    const { DEFAULT_MODEL } = await import("../src/config.ts");
    expect(buildConfig("/opt/mosaic", "/home/u/.mosaic").model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("opencode/big-pickle");
  });
});

describe("global config is not a project config", () => {
  test("~/.mosaic is skipped when walking up", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadProjectConfig } = await import("../src/config.ts");

    const home = mkdtempSync(join(tmpdir(), "mosaic-h-"));
    const mosaicHome = join(home, ".mosaic");
    mkdirSync(mosaicHome, { recursive: true });
    // This is the *global* config. Walking up from work under $HOME would
    // otherwise re-apply it as a project config and duplicate its arrays.
    writeFileSync(join(mosaicHome, "config.json"), JSON.stringify({ instructions: ["global.md"] }));

    const work = join(home, "projects", "thing");
    mkdirSync(work, { recursive: true });
    expect(await loadProjectConfig(work, mosaicHome)).toBeNull();
  });
});

describe("background model", () => {
  test("titles and summaries use the same model by default", async () => {
    const { DEFAULT_MODEL } = await import("../src/config.ts");
    const cfg = buildConfig("/opt/mosaic", "/home/u/.mosaic");
    // Left unset the engine picks its own small model, which on the free tier
    // can be slower than the one actually chosen.
    expect(cfg.small_model).toBe(cfg.model);
    expect(cfg.small_model).toBe(DEFAULT_MODEL);
  });
});
