import { describe, expect, test } from "bun:test";
import { fuzzyFilter, fuzzyScore } from "../src/fuzzy.ts";

const rank = (items: string[], q: string) => fuzzyFilter(items, q, (s) => s).map((m) => m.item);

describe("fuzzyScore", () => {
  test("matches a subsequence and reports where", () => {
    const m = fuzzyScore("src/App.tsx", "app");
    expect(m).not.toBeNull();
    expect(m!.positions.map((i) => "src/App.tsx"[i]!.toLowerCase()).join("")).toBe("app");
  });

  test("rejects a non-subsequence", () => {
    expect(fuzzyScore("src/App.tsx", "zzz")).toBeNull();
  });

  test("an empty query matches everything", () => {
    expect(fuzzyScore("anything", "")).toEqual({ score: 0, positions: [] });
  });

  test("is case-insensitive", () => {
    expect(fuzzyScore("README.md", "readme")).not.toBeNull();
    expect(fuzzyScore("readme.md", "README")).not.toBeNull();
  });
});

describe("ranking", () => {
  test("prefers the basename over a directory match", () => {
    expect(rank(["apparel/index.ts", "src/app.ts"], "app")[0]).toBe("src/app.ts");
  });

  test("prefers consecutive runs over scattered letters", () => {
    expect(rank(["a/b/c/parts.ts", "src/apps.ts"], "apps")[0]).toBe("src/apps.ts");
  });

  test("prefers the shorter path when both match equally", () => {
    expect(rank(["src/very/deep/nested/app.ts", "src/app.ts"], "app")[0]).toBe("src/app.ts");
  });

  test("segment starts outrank mid-word matches", () => {
    expect(rank(["xxconfigxx.ts", "src/config.ts"], "config")[0]).toBe("src/config.ts");
  });

  test("drops candidates that do not match at all", () => {
    expect(rank(["alpha.ts", "beta.ts"], "zzz")).toEqual([]);
  });

  test("respects the result limit", () => {
    const many = Array.from({ length: 200 }, (_, i) => `file${i}.ts`);
    expect(fuzzyFilter(many, "file", (s) => s, 10)).toHaveLength(10);
  });
});
