import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatInterval, JobStore, parseInterval } from "../src/heartbeat/store.ts";

let dir: string;
let store: JobStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mosaic-hb-"));
  store = new JobStore(join(dir, "heartbeat.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const job = (over: Partial<Parameters<JobStore["add"]>[0]> = {}) => ({
  name: "j",
  prompt: "check something",
  interval: 3600,
  cwd: "/tmp",
  ...over,
});

describe("intervals", () => {
  test("parses the units people actually type", () => {
    expect(parseInterval("90s")).toBe(90);
    expect(parseInterval("30m")).toBe(1800);
    expect(parseInterval("2h")).toBe(7200);
    expect(parseInterval("1d")).toBe(86400);
    expect(parseInterval("120")).toBe(120);
  });

  test("rejects nonsense instead of scheduling something surprising", () => {
    expect(() => parseInterval("soon")).toThrow();
    expect(() => parseInterval("5 weeks")).toThrow();
  });

  test("round-trips through formatting", () => {
    for (const text of ["90s", "30m", "2h", "1d"]) {
      expect(formatInterval(parseInterval(text))).toBe(text);
    }
  });
});

describe("adding jobs", () => {
  test("stores a job", () => {
    const j = store.add(job());
    expect(j.name).toBe("j");
    expect(j.agent).toBe("mosaic");
    expect(j.runs).toBe(0);
  });

  // A 1s heartbeat is a fork bomb with extra steps, and each tick costs money.
  test("refuses an interval under a minute", () => {
    expect(() => store.add(job({ interval: 5 }))).toThrow(/at least 60/);
  });

  test("refuses an empty prompt", () => {
    expect(() => store.add(job({ prompt: "   " }))).toThrow();
  });

  test("names are unique, so re-adding does not silently duplicate", () => {
    store.add(job());
    expect(() => store.add(job())).toThrow();
  });
});

describe("scheduling", () => {
  test("a new job is due immediately, not one interval from now", () => {
    store.add(job({ interval: 86400 }));
    // Otherwise adding a daily job means nothing happens for a day.
    expect(store.due().map((j) => j.name)).toEqual(["j"]);
  });

  test("not due again until the interval has passed", () => {
    const j = store.add(job({ interval: 3600 }));
    store.recordRun(j.id, "ok");
    expect(store.due()).toEqual([]);
    expect(store.due(Date.now() + 3600_000).map((x) => x.name)).toEqual(["j"]);
  });

  test("disabled jobs never run", () => {
    store.add(job());
    store.setEnabled("j", false);
    expect(store.due()).toEqual([]);
  });

  test("stops at max-runs, so a bounded job stays bounded", () => {
    const j = store.add(job({ maxRuns: 2 }));
    store.recordRun(j.id, "ok");
    store.recordRun(j.id, "ok");
    expect(store.due(Date.now() + 999_999_999)).toEqual([]);
  });

  test("records the last status for the log", () => {
    const j = store.add(job());
    store.recordRun(j.id, "ok: did the thing");
    expect(store.get("j")?.lastStatus).toBe("ok: did the thing");
    expect(store.get("j")?.runs).toBe(1);
  });
});

describe("lookup", () => {
  test("by name or id", () => {
    const j = store.add(job());
    expect(store.get("j")?.id).toBe(j.id);
    expect(store.get(String(j.id))?.name).toBe("j");
  });

  test("remove reports whether anything went", () => {
    store.add(job());
    expect(store.remove("j")).toBe(true);
    expect(store.remove("j")).toBe(false);
  });
});
