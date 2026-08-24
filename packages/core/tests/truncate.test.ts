import { describe, expect, test } from "bun:test";
import { truncateMiddle, windowLines } from "../src/tools/truncate.ts";

describe("truncateMiddle (golden)", () => {
  test("passes through short input unchanged", () => {
    const out = truncateMiddle("hello world", { maxChars: 100 });
    expect(out).toEqual({ text: "hello world", truncated: false, originalChars: 11 });
  });

  test("elides the middle, keeping head and tail", () => {
    const input = "A".repeat(600) + "MIDDLE" + "Z".repeat(600);
    const out = truncateMiddle(input, { maxChars: 200 });
    expect(out.truncated).toBe(true);
    expect(out.originalChars).toBe(1206);
    expect(out.text.length).toBeLessThanOrEqual(200);
    expect(out.text.startsWith("A".repeat(50))).toBe(true);
    expect(out.text.endsWith("Z".repeat(50))).toBe(true);
    expect(out.text).toContain("chars elided");
    expect(out.text).not.toContain("MIDDLE");
  });

  test("reports the exact number of elided chars", () => {
    const input = "x".repeat(1000);
    const out = truncateMiddle(input, { maxChars: 200 });
    const match = out.text.match(/\[([\d,]+) chars elided\]/);
    expect(match).not.toBeNull();
    const elided = Number(match![1]!.replace(/,/g, ""));
    const kept = out.text.replace(/\n… \[[\d,]+ chars elided\] …\n/, "").length;
    expect(elided).toBe(1000 - kept);
  });

  test("respects headRatio", () => {
    const input = "H".repeat(500) + "T".repeat(500);
    const headHeavy = truncateMiddle(input, { maxChars: 240, headRatio: 0.9 });
    const headCount = headHeavy.text.split("…")[0]!.replace(/[^H]/g, "").length;
    const tailCount = headHeavy.text.split("…")[2]!.replace(/[^T]/g, "").length;
    expect(headCount).toBeGreaterThan(tailCount);
  });
});

describe("windowLines (golden)", () => {
  const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");

  test("returns the requested window", () => {
    const win = windowLines(content, 10, 5);
    expect(win).toEqual({
      text: "line 10\nline 11\nline 12\nline 13\nline 14",
      totalLines: 100,
      startLine: 10,
      endLine: 14,
      skippedBefore: 9,
      skippedAfter: 86,
    });
  });

  test("clamps start beyond EOF to the last line", () => {
    const win = windowLines(content, 500, 10);
    expect(win.startLine).toBe(100);
    expect(win.endLine).toBe(100);
    expect(win.text).toBe("line 100");
  });

  test("window at EOF has nothing skipped after", () => {
    const win = windowLines(content, 96, 10);
    expect(win.endLine).toBe(100);
    expect(win.skippedAfter).toBe(0);
  });
});
