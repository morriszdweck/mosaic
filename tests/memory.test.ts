import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, tokenize } from "../src/plugin/memory/store.ts";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mosaic-mem-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("tokenize", () => {
  test("drops stopwords and short words", () => {
    expect(tokenize("the user is a developer")).toEqual(["user", "developer"]);
  });

  test("keeps paths and identifiers intact", () => {
    expect(tokenize("edit src/config.ts")).toEqual(["edit", "src/config.ts"]);
  });
});

describe("remember", () => {
  test("stores and returns a memory", () => {
    const m = store.remember({ kind: "user", content: "Prefers terse answers." });
    expect(m.id).toBeGreaterThan(0);
    expect(store.count()).toBe(1);
  });

  test("a reworded duplicate updates in place instead of piling up", () => {
    store.remember({ kind: "preference", content: "The user prefers terse concise answers" });
    store.remember({ kind: "preference", content: "user prefers concise terse answers please" });
    // Left unchecked, repeated turns about one preference would crowd out
    // everything else at recall time.
    expect(store.count()).toBe(1);
  });

  test("genuinely different facts are kept apart", () => {
    store.remember({ kind: "fact", content: "Deploys run on Tuesday mornings" });
    store.remember({ kind: "fact", content: "The staging database is in Frankfurt" });
    expect(store.count()).toBe(2);
  });
});

describe("recall is bounded", () => {
  test("returns nothing when nothing is relevant", () => {
    store.remember({ kind: "fact", content: "The staging database is in Frankfurt" });
    // An unrelated question should cost zero context.
    expect(store.recall("what is the capital of Peru")).toEqual([]);
  });

  test("respects the count limit", () => {
    for (let i = 0; i < 20; i++) store.remember({ kind: "fact", content: `Kubernetes cluster ${i} runs workloads` });
    expect(store.recall("kubernetes cluster", { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  test("respects the character budget", () => {
    for (let i = 0; i < 10; i++) {
      store.remember({ kind: "fact", content: `Kubernetes deployment note ${i}: ${"x".repeat(200)}` });
    }
    const hits = store.recall("kubernetes deployment", { limit: 10, charBudget: 500 });
    const total = hits.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(500);
  });

  test("cost does not grow with store size — the point of the whole design", () => {
    for (let i = 0; i < 500; i++) store.remember({ kind: "fact", content: `Unrelated trivia number ${i} about birds` });
    store.remember({ kind: "project", content: "The deploy script requires VPN access" });
    const hits = store.recall("deploy script vpn", { limit: 5, charBudget: 800 });
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(hits[0]?.content).toContain("deploy script");
  });

  test("ranks the on-topic memory first", () => {
    store.remember({ kind: "fact", content: "Coffee machine is on the third floor" });
    store.remember({ kind: "project", content: "Migrations run with bun run migrate" });
    expect(store.recall("how do I run migrations")[0]?.content).toContain("migrate");
  });

  test("an empty or stopword-only query recalls nothing", () => {
    store.remember({ kind: "fact", content: "Something worth remembering here" });
    expect(store.recall("")).toEqual([]);
    expect(store.recall("the a of and is")).toEqual([]);
  });
});

describe("scoping", () => {
  test("project memories stay out of other projects", () => {
    store.remember({ kind: "project", content: "Uses pnpm not npm", scope: "/repo/alpha" });
    expect(store.recall("pnpm npm", { scope: "/repo/beta" })).toEqual([]);
    expect(store.recall("pnpm npm", { scope: "/repo/alpha" }).length).toBe(1);
  });

  test("global memories surface everywhere", () => {
    store.remember({ kind: "user", content: "Answers should be terse", scope: null });
    expect(store.recall("terse answers", { scope: "/anywhere" }).length).toBe(1);
  });
});

describe("forget", () => {
  test("removes a memory", () => {
    const m = store.remember({ kind: "fact", content: "Temporary detail worth dropping" });
    expect(store.forget(m.id)).toBe(true);
    expect(store.count()).toBe(0);
  });

  test("reports a miss rather than throwing", () => {
    expect(store.forget(9999)).toBe(false);
  });
});
