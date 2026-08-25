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
  paths = { source: join(root, "vendor", "swarm"), configDir: join(home, "config", "opencode") };
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
    await syncSwarm(paths);
    expect(existsSync(join(paths.configDir, "skill", "opencode-swarm", "SKILL.md"))).toBe(true);
  });

  test("is idempotent — running twice changes nothing", async () => {
    await syncSwarm(paths);
    const second = await syncSwarm(paths);
    expect(second.skipped).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  test("does nothing when swarm is not vendored", async () => {
    rmSync(join(root, "vendor"), { recursive: true, force: true });
    // Swarm is optional; a missing checkout must not break startup.
    const result = await syncSwarm(paths);
    expect(result).toEqual({ installed: [], skipped: [], removed: [] });
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
