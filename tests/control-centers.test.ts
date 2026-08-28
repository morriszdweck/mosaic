import { describe, expect, test } from "bun:test";
import type { Session } from "@opencode-ai/sdk/v2";
import { memoryOptions } from "../src/plugin/branding/memory-control.tsx";
import { runOptions } from "../src/plugin/branding/runs-control.tsx";

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
