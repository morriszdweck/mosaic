import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeWhen, parseWhen, TaskStore } from "../src/plugin/schedule/store.ts";

let dir: string;
let store: TaskStore;
const NOW = new Date("2026-08-25T12:00:00Z").getTime();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mosaic-task-"));
  store = new TaskStore(join(dir, "tasks.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const add = (over: Partial<Parameters<TaskStore["add"]>[0]> = {}) =>
  store.add({ sessionID: "ses_1", prompt: "check the thing", dueAt: NOW, when: "in 1m", ...over });

describe("parseWhen", () => {
  test("relative delays", () => {
    expect(parseWhen("in 10m", NOW)).toEqual({ dueAt: NOW + 600_000, repeat: null });
    expect(parseWhen("30s", NOW)).toEqual({ dueAt: NOW + 30_000, repeat: null });
    expect(parseWhen("in 2 hours", NOW)).toEqual({ dueAt: NOW + 7_200_000, repeat: null });
  });

  test("repeats carry an interval", () => {
    expect(parseWhen("every 2h", NOW)).toEqual({ dueAt: NOW + 7_200_000, repeat: 7200 });
  });

  test("an absolute time that has passed rolls to tomorrow", () => {
    const morning = new Date(NOW);
    morning.setHours(9, 0, 0, 0);
    const parsed = parseWhen("at 09:00", NOW);
    // Otherwise "at 09:00" at noon means "immediately", which is never meant.
    expect(parsed.dueAt).toBeGreaterThan(NOW);
    expect(parsed.dueAt - morning.getTime()).toBe(86_400_000);
  });

  // A scheduler that guesses is worse than one that admits it did not parse.
  test("refuses phrasings it cannot read", () => {
    expect(() => parseWhen("soon", NOW)).toThrow();
    expect(() => parseWhen("next tuesday", NOW)).toThrow();
  });
});

describe("tasks", () => {
  test("are scoped to the session that made them", () => {
    add({ sessionID: "ses_1" });
    add({ sessionID: "ses_2" });
    expect(store.list("ses_1")).toHaveLength(1);
    expect(store.due("ses_2", NOW)).toHaveLength(1);
  });

  test("are not due before their time", () => {
    add({ dueAt: NOW + 60_000 });
    expect(store.due("ses_1", NOW)).toHaveLength(0);
    expect(store.due("ses_1", NOW + 60_000)).toHaveLength(1);
  });

  test("a one-shot retires after firing", () => {
    const t = add();
    store.recordFired(t.id, NOW);
    expect(store.list("ses_1")).toHaveLength(0);
    expect(store.get(t.id)?.done).toBe(true);
  });

  test("a repeat reschedules from now, not from the missed due time", () => {
    const t = add({ repeat: 3600, dueAt: NOW });
    // Mosaic closed for a week: catching up would fire the task 168 times.
    const muchLater = NOW + 7 * 86_400_000;
    store.recordFired(t.id, muchLater);
    expect(store.get(t.id)?.dueAt).toBe(muchLater + 3_600_000);
    expect(store.due("ses_1", muchLater)).toHaveLength(0);
  });

  test("cancel stops a pending task, and says when there was none", () => {
    const t = add();
    expect(store.cancel(t.id)).toBe(true);
    expect(store.cancel(t.id)).toBe(false);
    expect(store.list("ses_1")).toHaveLength(0);
  });

  test("refuses an empty prompt and a too-fast repeat", () => {
    expect(() => add({ prompt: "  " })).toThrow();
    expect(() => add({ repeat: 5 })).toThrow(/at least 60/);
  });
});

describe("describeWhen", () => {
  test("reads as a delay, and names the repeat", () => {
    const once = add({ dueAt: NOW + 600_000 });
    expect(describeWhen(once, NOW)).toBe("in 10m");
    const repeating = add({ dueAt: NOW + 600_000, repeat: 7200, when: "every 2h" });
    expect(describeWhen(repeating, NOW)).toContain("every 120m");
  });
});
