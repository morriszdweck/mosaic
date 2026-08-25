import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { swarmAgentNames, syncSwarm, type SwarmPaths } from "../src/swarm.ts";

let root: string;
let home: string;
let paths: SwarmPaths;

const agent = (name: string, body: string) =>
  writeFileSync(join(root, "vendor", "swarm", "agents", `${name}.md`), `---\ndescription: ${body}\n---\n${body}\n`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mosaic-swarm-"));
  home = mkdtempSync(join(tmpdir(), "mosaic-swarm-home-"));
  mkdirSync(join(root, "vendor", "swarm", "agents"), { recursive: true });
  mkdirSync(join(root, "vendor", "swarm", "skills", "opencode-swarm"), { recursive: true });
  writeFileSync(join(root, "vendor", "swarm", "skills", "opencode-swarm", "SKILL.md"), "# skill\n");
  agent("swarm", "orchestrator");
  agent("reviewer", "reviews things");
  mkdirSync(join(root, "agents"), { recursive: true });
  paths = {
    source: join(root, "vendor", "swarm"),
    overrides: join(root, "agents"),
    configDir: join(home, "config", "opencode"),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("sync", () => {
  test("installs agents where the engine looks for them", async () => {
    const result = await syncSwarm(paths);
    expect(result.installed).toContain("swarm.md");
    expect(existsSync(join(paths.configDir, "agent", "swarm.md"))).toBe(true);
  });

  test("installs skills as a directory containing SKILL.md", async () => {
    mkdirSync(join(root, "vendor", "swarm", "skills", "extra"), { recursive: true });
    writeFileSync(join(root, "vendor", "swarm", "skills", "extra", "SKILL.md"), "# extra\n");
    await syncSwarm(paths);
    expect(existsSync(join(paths.configDir, "skill", "extra", "SKILL.md"))).toBe(true);
  });

  test("is idempotent — running twice changes nothing", async () => {
    await syncSwarm(paths);
    const second = await syncSwarm(paths);
    expect(second.skipped).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  test("does nothing when neither source exists", async () => {
    rmSync(join(root, "vendor"), { recursive: true, force: true });
    rmSync(join(root, "agents"), { recursive: true, force: true });
    // Swarm is optional; a missing checkout must not break startup.
    const result = await syncSwarm(paths);
    expect(result).toEqual({ installed: [], skipped: [], removed: [] });
  });

  test("Mosaic's own agents install without the vendored checkout", async () => {
    rmSync(join(root, "vendor"), { recursive: true, force: true });
    writeFileSync(join(root, "agents", "swarm.md"), "---\ndescription: general\n---\ngeneral\n");
    const result = await syncSwarm(paths);
    expect(result.installed).toContain("swarm.md");
  });
});

describe("overrides", () => {
  test("Mosaic's general version replaces the vendored coding one", async () => {
    // Upstream swarm is written for coding work; Mosaic ships general versions
    // under the same names, and they have to be the ones that land.
    writeFileSync(join(root, "agents", "reviewer.md"), "---\ndescription: general reviewer\n---\nGENERAL\n");
    await syncSwarm(paths);
    expect(readFileSync(join(paths.configDir, "agent", "reviewer.md"), "utf8")).toContain("GENERAL");
  });

  test("a vendored agent with no override is still installed", async () => {
    writeFileSync(join(root, "agents", "reviewer.md"), "---\ndescription: general\n---\nGENERAL\n");
    await syncSwarm(paths);
    // swarm.md exists only upstream in this fixture.
    expect(readFileSync(join(paths.configDir, "agent", "swarm.md"), "utf8")).toContain("orchestrator");
  });

  test("each name is installed once, not duplicated across sources", async () => {
    writeFileSync(join(root, "agents", "reviewer.md"), "---\ndescription: general\n---\nGENERAL\n");
    const result = await syncSwarm(paths);
    expect(result.installed.filter((f) => f === "reviewer.md")).toHaveLength(1);
  });
});

describe("user files", () => {
  test("an agent the user wrote is never overwritten", async () => {
    mkdirSync(join(paths.configDir, "agent"), { recursive: true });
    writeFileSync(join(paths.configDir, "agent", "reviewer.md"), "MINE");
    const result = await syncSwarm(paths);
    // Agent names are a flat namespace; replacing someone's file silently is
    // not a tradeoff worth making for convenience.
    expect(result.skipped).toContain("reviewer.md");
    expect(readFileSync(join(paths.configDir, "agent", "reviewer.md"), "utf8")).toBe("MINE");
  });

  test("the rest still install alongside it", async () => {
    mkdirSync(join(paths.configDir, "agent"), { recursive: true });
    writeFileSync(join(paths.configDir, "agent", "reviewer.md"), "MINE");
    const result = await syncSwarm(paths);
    expect(result.installed).toContain("swarm.md");
  });
});

describe("stale files", () => {
  test("an agent swarm no longer ships is removed", async () => {
    await syncSwarm(paths);
    rmSync(join(paths.source, "agents", "reviewer.md"));
    const result = await syncSwarm(paths);
    expect(result.removed).toContain("reviewer.md");
    expect(existsSync(join(paths.configDir, "agent", "reviewer.md"))).toBe(false);
  });

  test("a file the user added is not treated as stale", async () => {
    await syncSwarm(paths);
    writeFileSync(join(paths.configDir, "agent", "mine.md"), "MINE");
    const result = await syncSwarm(paths);
    expect(result.removed).not.toContain("mine.md");
    expect(existsSync(join(paths.configDir, "agent", "mine.md"))).toBe(true);
  });
});

describe("names", () => {
  test("lists what swarm contributes", async () => {
    expect(await swarmAgentNames(paths.source)).toEqual(["reviewer", "swarm"]);
  });

  test("empty when not vendored", async () => {
    expect(await swarmAgentNames(join(root, "nope"))).toEqual([]);
  });
});

describe("Agent Swarm skill", () => {
  test("Mosaic's skill supersedes the upstream one", async () => {
    mkdirSync(join(root, "skills", "agent-swarm"), { recursive: true });
    writeFileSync(join(root, "skills", "agent-swarm", "SKILL.md"), "---\nname: agent-swarm\n---\nAgent Swarm\n");
    await syncSwarm(paths);
    // Both would offer the model two overlapping skills that disagree on what
    // the feature is even called.
    expect(existsSync(join(paths.configDir, "skill", "agent-swarm"))).toBe(true);
    expect(existsSync(join(paths.configDir, "skill", "opencode-swarm"))).toBe(false);
  });

  test("an unrelated vendored skill is still installed", async () => {
    mkdirSync(join(root, "vendor", "swarm", "skills", "something-else"), { recursive: true });
    writeFileSync(join(root, "vendor", "swarm", "skills", "something-else", "SKILL.md"), "x");
    await syncSwarm(paths);
    expect(existsSync(join(paths.configDir, "skill", "something-else"))).toBe(true);
  });
});
