import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeWhen, isStale, parseWhen, TaskStore } from "../src/plugin/schedule/store.ts";

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

/** Local wall-clock helper, so these read the same in any timezone. */
function localAt(base: number, dayOffset: number, minute: number): number {
  const at = new Date(base);
  at.setDate(at.getDate() + dayOffset);
  at.setHours(0, minute, 0, 0);
  return at.getTime();
}

/** The next occurrence of `minute` on one of `days`, by brute force. */
function nextLocal(base: number, minute: number, days?: number[]): number {
  for (let offset = 0; offset <= 8; offset++) {
    const at = localAt(base, offset, minute);
    if (days && !days.includes(new Date(at).getDay())) continue;
    if (at > base) return at;
  }
  throw new Error("no occurrence");
}

describe("calendar recurrences", () => {
  test("every day at a time", () => {
    const parsed = parseWhen("every day at 09:00", NOW);
    expect(parsed.recurrence).toEqual({ kind: "daily", minute: 540 });
    expect(parsed.repeat).toBeNull();
    expect(parsed.dueAt).toBe(nextLocal(NOW, 540));
  });

  test("weekday, weekend, and named days", () => {
    expect(parseWhen("every weekday at 08:30", NOW).recurrence).toEqual({
      kind: "weekly",
      minute: 510,
      days: [1, 2, 3, 4, 5],
    });
    expect(parseWhen("every weekend at 10:00", NOW).recurrence).toEqual({ kind: "weekly", minute: 600, days: [0, 6] });
    expect(parseWhen("every monday at 17:00", NOW).recurrence).toEqual({ kind: "weekly", minute: 1020, days: [1] });
    expect(parseWhen("every mon and thu at 9am", NOW).recurrence).toEqual({
      kind: "weekly",
      minute: 540,
      days: [1, 4],
    });
  });

  test("the phrasings people type for a time of day", () => {
    const minute = (text: string) => parseWhen(`every day at ${text}`, NOW).recurrence;
    expect(minute("9")).toMatchObject({ minute: 540 });
    expect(minute("9am")).toMatchObject({ minute: 540 });
    expect(minute("9pm")).toMatchObject({ minute: 1260 });
    expect(minute("12am")).toMatchObject({ minute: 0 });
    expect(minute("12pm")).toMatchObject({ minute: 720 });
    expect(minute("noon")).toMatchObject({ minute: 720 });
    expect(minute("midnight")).toMatchObject({ minute: 0 });
    expect(minute("5:15 pm")).toMatchObject({ minute: 1035 });
  });

  test("a day with no time is refused rather than given one", () => {
    // Picking a default silently schedules something for a time nobody chose.
    expect(() => parseWhen("every day", NOW)).toThrow();
    expect(() => parseWhen("every monday", NOW)).toThrow();
    expect(() => parseWhen("every day at teatime", NOW)).toThrow();
  });

  test("a calendar repeat keeps its wall time instead of drifting", () => {
    const parsed = parseWhen("every day at 09:00", NOW);
    const task = store.add({
      sessionID: "ses_1",
      scope: "standalone",
      prompt: "brief me",
      when: "every day at 09:00",
      dueAt: parsed.dueAt,
      recurrence: parsed.recurrence ?? null,
    });
    // Fired five minutes late: the next one is still 09:00, not 09:05.
    store.recordFired(task.id, parsed.dueAt + 300_000);
    expect(store.get(task.id)?.dueAt).toBe(nextLocal(parsed.dueAt + 300_000, 540));
  });

  test("describeWhen names the pattern, not just the delay", () => {
    const parsed = parseWhen("every weekday at 08:30", NOW);
    const task = store.add({
      sessionID: "ses_1",
      scope: "standalone",
      prompt: "brief me",
      when: "every weekday at 08:30",
      dueAt: parsed.dueAt,
      recurrence: parsed.recurrence ?? null,
    });
    expect(describeWhen(task, NOW)).toContain("every weekday at 08:30");
  });
});

describe("staleness", () => {
  const daily = (dueAt: number) => ({ dueAt, repeat: null, recurrence: { kind: "daily" as const, minute: 540 } });

  test("a run that is late but still within its period goes ahead", () => {
    const due = localAt(NOW, 0, 540);
    expect(isStale(daily(due), due + 3_600_000)).toBe(false);
  });

  test("a run whose next one is already due is skipped instead", () => {
    // Otherwise yesterday's 09:00 briefing arrives just before today's.
    const due = localAt(NOW, -1, 540);
    expect(isStale(daily(due), localAt(NOW, 0, 600))).toBe(true);
  });

  test("a one-shot is never stale — a late reminder is still the reminder", () => {
    expect(isStale({ dueAt: NOW, repeat: null, recurrence: null }, NOW + 30 * 86_400_000)).toBe(false);
  });
});

describe("standalone tasks", () => {
  const standing = (over: Partial<Parameters<TaskStore["add"]>[0]> = {}) =>
    store.add({
      scope: "standalone",
      directory: "/work/a",
      prompt: "morning brief",
      when: "every day at 09:00",
      dueAt: NOW,
      recurrence: { kind: "daily", minute: 540 },
      ...over,
    });

  test("belong to no conversation, so they never fire into one", () => {
    standing();
    expect(store.list("ses_1")).toHaveLength(0);
    expect(store.due("ses_1", NOW)).toHaveLength(0);
    expect(store.dueStandalone(NOW)).toHaveLength(1);
  });

  test("are listed per directory", () => {
    standing({ directory: "/work/a" });
    standing({ directory: "/work/b" });
    expect(store.listStandalone("/work/a")).toHaveLength(1);
    expect(store.listStandalone()).toHaveLength(2);
  });

  test("keep what the last run produced", () => {
    const task = standing();
    store.recordRun(task.id, "ok", "all quiet", NOW);
    const after = store.get(task.id);
    expect(after?.lastStatus).toBe("ok");
    expect(after?.lastOutput).toBe("all quiet");
    expect(after?.lastRunAt).toBe(NOW);
  });

  test("keep only the tail of a long run", () => {
    const task = standing();
    store.recordRun(task.id, "ok", `${"x".repeat(9000)}END`, NOW);
    const output = store.get(task.id)?.lastOutput ?? "";
    expect(output.length).toBeLessThanOrEqual(4000);
    expect(output.endsWith("END")).toBe(true);
  });

  test("a session task still needs a session", () => {
    expect(() => store.add({ prompt: "x", when: "in 1m", dueAt: NOW })).toThrow(/needs a session/);
  });
});

describe("upgrading an existing database", () => {
  test("a tasks.db from before standalone tasks still opens", () => {
    // CREATE TABLE IF NOT EXISTS is a no-op against an old file, so every new
    // column has to be added by the migration or nothing reads it.
    const path = join(dir, "old.db");
    const old = new Database(path, { create: true });
    old.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        repeat INTEGER,
        when_text TEXT NOT NULL,
        heartbeat INTEGER NOT NULL DEFAULT 0,
        fired INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      );
    `);
    old.prepare(
      "INSERT INTO tasks (session_id, prompt, due_at, when_text, created_at) VALUES ('ses_old', 'check', ?, 'in 1m', ?)",
    ).run(NOW, NOW);
    old.close();

    const upgraded = new TaskStore(path);
    const tasks = upgraded.list("ses_old");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.scope).toBe("session");
    expect(tasks[0]?.recurrence).toBeNull();
    expect(upgraded.listStandalone()).toHaveLength(0);
    upgraded.close();
  });

  test("a pre-heartbeat tasks.db migrates heartbeat and supports every task type", () => {
    const path = join(dir, "pre-heartbeat.db");
    const old = new Database(path, { create: true });
    old.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        repeat INTEGER,
        when_text TEXT NOT NULL,
        fired INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      );
    `);
    old.prepare(
      "INSERT INTO tasks (session_id, prompt, due_at, when_text, created_at) VALUES ('ses_old', 'legacy check', ?, 'in 1m', ?)",
    ).run(NOW, NOW);
    old.close();

    const upgraded = new TaskStore(path);
    const existing = upgraded.get(1);
    expect(existing?.prompt).toBe("legacy check");
    expect(existing?.heartbeat).toBe(false);

    const ordinary = upgraded.add({ sessionID: "ses_new", prompt: "check once", dueAt: NOW, when: "in 1m" });
    const heartbeat = upgraded.add({
      sessionID: "ses_new",
      prompt: "check continuously",
      dueAt: NOW,
      repeat: 600,
      when: "every 10m",
      heartbeat: true,
    });
    expect(ordinary.heartbeat).toBe(false);
    expect(heartbeat.heartbeat).toBe(true);
    expect(upgraded.list("ses_new")).toHaveLength(2);
    expect(upgraded.heartbeatFor("ses_new")?.id).toBe(heartbeat.id);
    upgraded.close();

    const migrated = new Database(path);
    const heartbeatColumn = (migrated.prepare("PRAGMA table_info(tasks)").all() as Array<{
      name: string;
      dflt_value: string | null;
    }>).find((column) => column.name === "heartbeat");
    expect(heartbeatColumn).toMatchObject({ name: "heartbeat", dflt_value: "0" });
    expect(migrated.prepare("SELECT heartbeat FROM tasks WHERE id = 1").get()).toEqual({ heartbeat: 0 });
    migrated.close();
  });
});
