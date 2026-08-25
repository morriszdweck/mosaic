import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../src/plugin/schedule/store.ts";

let dir: string;
let store: TaskStore;
const NOW = Date.now();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mosaic-hb-"));
  store = new TaskStore(join(dir, "tasks.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const beat = (over: Record<string, unknown> = {}) =>
  store.add({
    sessionID: "ses_1",
    prompt: "[heartbeat] check things",
    dueAt: NOW + 600_000,
    repeat: 600,
    when: "every 10m",
    heartbeat: true,
    ...over,
  });

describe("heartbeat", () => {
  test("is distinguishable from an ordinary scheduled task", () => {
    beat();
    store.add({ sessionID: "ses_1", prompt: "one-off", dueAt: NOW, when: "in 1m" });
    expect(store.heartbeatFor("ses_1")?.prompt).toContain("[heartbeat]");
  });

  test("is scoped to its session", () => {
    beat({ sessionID: "ses_1" });
    expect(store.heartbeatFor("ses_2")).toBeNull();
  });

  test("repeats rather than retiring after one beat", () => {
    const b = beat();
    store.recordFired(b.id, NOW);
    expect(store.heartbeatFor("ses_1")).not.toBeNull();
    expect(store.get(b.id)?.done).toBe(false);
  });

  test("stopping ends every heartbeat but leaves other tasks alone", () => {
    beat();
    const other = store.add({ sessionID: "ses_1", prompt: "one-off", dueAt: NOW, when: "in 1m" });
    expect(store.stopHeartbeats("ses_1")).toBe(1);
    expect(store.heartbeatFor("ses_1")).toBeNull();
    expect(store.get(other.id)?.done).toBe(false);
  });

  test("stopping when none is running reports zero rather than failing", () => {
    expect(store.stopHeartbeats("ses_1")).toBe(0);
  });

  // Two standing checks in one conversation interleave into reports nobody can
  // follow, so the tool replaces rather than stacking.
  test("only one can be current per session", () => {
    beat({ prompt: "[heartbeat] first" });
    store.stopHeartbeats("ses_1");
    beat({ prompt: "[heartbeat] second" });
    expect(store.list("ses_1").filter((t) => t.heartbeat)).toHaveLength(1);
    expect(store.heartbeatFor("ses_1")?.prompt).toContain("second");
  });
});

describe("skills the agent writes", () => {
  test("a written skill lands where the engine scans for it", () => {
    // Mirrors what the `skill` tool does: <home>/config/opencode/skill/<name>/SKILL.md
    const home = mkdtempSync(join(tmpdir(), "mosaic-sk-"));
    const skillDir = join(home, "config", "opencode", "skill", "weekly-report");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: weekly-report\ndescription: d\n---\nbody\n");
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toContain("name: weekly-report");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("themes", () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dir, "..", "themes", name), "utf8")) as {
      defs: Record<string, string>;
      theme: Record<string, { dark: string; light: string }>;
    };

  test("mosaic-dark shares the light theme's key set", async () => {
    const light = read("mosaic-light.json");
    const dark = read("mosaic-dark.json");
    expect(Object.keys(dark.theme).sort()).toEqual(Object.keys(light.theme).sort());
  });

  test("the two themes are distinct grounds, not copies of each other", () => {
    const light = read("mosaic-light.json");
    const dark = read("mosaic-dark.json");
    expect(dark.theme.background!.dark).not.toBe(light.theme.background!.dark);
  });

  test("every reference in every theme resolves", () => {
    for (const name of ["mosaic-light.json", "mosaic-dark.json"]) {
      const t = read(name);
      for (const value of Object.values(t.theme)) {
        for (const v of [value.dark, value.light]) {
          expect(/^#[0-9a-fA-F]{6}$/.test(v) || v in t.defs, `${name}: ${v}`).toBe(true);
        }
      }
    }
  });
});

describe("tool names", () => {
  test("the authoring tool does not collide with the engine's skill loader", async () => {
    const src = await Bun.file(new URL("../src/plugin/evolve/index.ts", import.meta.url)).text();
    // The engine ships a `skill` tool that *loads* skills. Registering another
    // tool with that name shadows it, and the agent silently loses the ability
    // to load any skill at all.
    expect(src).toContain("skill_write: tool({");
    expect(src).not.toMatch(/^\s{6}skill: tool\(\{/m);
  });
});
