import { describe, expect, test } from "bun:test";
import type { Session } from "@opencode-ai/sdk/v2";
import { memoryOptions } from "../src/plugin/branding/memory-control.tsx";
import { runOptions } from "../src/plugin/branding/runs-control.tsx";
import { matchesQuery, searchOptions, type SearchResult } from "../src/plugin/branding/search-control.tsx";
import { taskOptions } from "../src/plugin/branding/tasks-control.tsx";
import type { Task } from "../src/plugin/schedule/store.ts";

describe("memory control center options", () => {
  test("keeps newest memories first and exposes scope and usage", () => {
    const options = memoryOptions(
      [
        {
          id: 1,
          kind: "preference",
          content: "Prefer short summaries",
          scope: "/work/project",
          createdAt: 1_000,
          usedAt: 2_000,
          useCount: 0,
        },
        {
          id: 2,
          kind: "fact",
          content: "The launch is on Friday",
          scope: null,
          createdAt: 2_000,
          usedAt: 3_000,
          useCount: 2,
        },
      ],
      3_000,
    );

    expect(options.map((option) => option.value)).toEqual([2, 1]);
    expect(options[0]?.category).toBe("Everywhere");
    expect(options[0]?.footer).toContain("2 recalls");
    expect(options[1]?.category).toBe("This project");
  });
});

describe("runs control center options", () => {
  test("labels the current session and falls back for untitled runs", () => {
    const sessions = [
      {
        id: "current",
        slug: "current",
        projectID: "project",
        directory: "/work/project",
        title: "Current work",
        version: "1",
        time: { created: 1_000, updated: 3_000 },
      },
      {
        id: "older",
        slug: "older",
        projectID: "project",
        directory: "/work/project",
        title: "",
        version: "1",
        time: { created: 1_000, updated: 2_000 },
      },
    ] satisfies Session[];

    const options = runOptions(sessions, "current", 3_000);

    expect(options.map((option) => option.value)).toEqual(["current", "older"]);
    expect(options[0]?.category).toBe("Current session");
    expect(options[1]?.title).toBe("Untitled run");
    expect(options[1]?.description).toContain("/work/project");
  });

});

describe("tasks control center options", () => {
  test("orders upcoming work and exposes scope and last-run status", () => {
    const tasks = [
      {
        id: 1,
        sessionID: "current",
        scope: "session",
        directory: "",
        heartbeat: true,
        prompt: "Check the deployment",
        dueAt: 6_000,
        repeat: 600,
        recurrence: null,
        when: "every 10m",
        fired: 2,
        createdAt: 1_000,
        done: false,
        paused: false,
        lastRunAt: null,
        lastStatus: null,
        lastOutput: null,
      },
      {
        id: 2,
        sessionID: "",
        scope: "standalone",
        directory: "/work/project",
        heartbeat: false,
        prompt: "Send the daily brief",
        dueAt: 4_000,
        repeat: null,
        recurrence: null,
        when: "at 09:00",
        fired: 1,
        createdAt: 2_000,
        done: false,
        paused: false,
        lastRunAt: 3_000,
        lastStatus: "failed",
        lastOutput: "Provider unavailable",
      },
    ] satisfies Task[];

    const options = taskOptions(tasks, 3_000);

    expect(options.map((option) => option.value)).toEqual([2, 1]);
    expect(options[0]?.category).toBe("Standing task");
    expect(options[0]?.footer).toContain("last failed");
    expect(options[1]?.category).toBe("Heartbeat");
  });
});

describe("search control center", () => {
  test("matches every search term without depending on case", () => {
    expect(matchesQuery("Launch checklist and final review", "FINAL launch")).toBe(true);
    expect(matchesQuery("Launch checklist", "launch review")).toBe(false);
  });

  test("groups result types with useful display metadata", () => {
    const results = [
      {
        kind: "message",
        sessionID: "run-1",
        title: "Launch plan",
        role: "user",
        snippet: "Review the final launch checklist",
        createdAt: 2_000,
      },
      {
        kind: "file",
        path: "notes/launch.md",
        line: 4,
        snippet: "The launch checklist is ready.",
      },
    ] satisfies SearchResult[];

    const options = searchOptions(results);

    expect(options[0]?.category).toBe("Messages");
    expect(options[0]?.description).toContain("Review the final launch checklist");
    expect(options[1]?.category).toBe("Files");
    expect(options[1]?.footer).toContain("line 4");
  });
});
