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
      expect(p.startsWith("/")).toBe(true);
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
    expect(Object.keys(AGENTS).sort()).toEqual(["analyst", "coder", "mosaic", "research", "writer"]);
  });

  test("every agent has a description and a system prompt", () => {
    for (const [name, agent] of Object.entries(AGENTS)) {
      expect(agent.description, name).toBeTruthy();
      expect(agent.system, name).toBeTruthy();
    }
  });

  test("the primary prompt frames the agent as general-purpose, not a coding tool", () => {
    expect(AGENTS.mosaic!.system).toContain("not limited to programming");
  });
});
