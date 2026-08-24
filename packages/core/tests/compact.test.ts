import { describe, expect, test } from "bun:test";
import { compactDeterministic, findKeepIndex, needsCompaction } from "../src/tokens/compact.ts";
import { estimateContextTokens, estimateTokens, TokenMeter } from "../src/tokens/meter.ts";
import type { Message } from "../src/types.ts";

const OPTIONS = { contextWindow: 1000, compactAt: 0.8, keepLastTurns: 2 };

function conversation(turns: number, charsPerMsg = 10): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: "user", content: `question ${i} ` + "q".repeat(charsPerMsg) });
    msgs.push({ role: "assistant", content: `answer ${i} ` + "a".repeat(charsPerMsg) });
  }
  return msgs;
}

describe("findKeepIndex (golden)", () => {
  test("keeps the last N user turns verbatim", () => {
    const msgs = conversation(5);
    // keepLastTurns=2 → keep turns 4 and 5: indices 6..9
    expect(findKeepIndex(msgs, 2)).toBe(6);
  });

  test("returns length when there are fewer turns than keepLastTurns", () => {
    expect(findKeepIndex(conversation(1), 4)).toBe(2);
  });

  test("ignores compacted marker messages when counting turns", () => {
    const msgs: Message[] = [
      { role: "user", content: "[digest]", compacted: true },
      ...conversation(3),
    ];
    expect(findKeepIndex(msgs, 2)).toBe(3);
  });
});

describe("needsCompaction", () => {
  test("triggers above the threshold", () => {
    // 1000-token window, compact at 0.8 → 800 tokens ≈ 3200 chars
    expect(needsCompaction("", conversation(30, 30), OPTIONS)).toBe(true);
  });
  test("stays quiet below the threshold", () => {
    expect(needsCompaction("", conversation(3, 10), OPTIONS)).toBe(false);
  });
});

describe("compactDeterministic (golden)", () => {
  test("collapses old turns into a digest, keeping recent turns verbatim", () => {
    const msgs = conversation(10, 50);
    const before = estimateContextTokens("", msgs);
    const result = compactDeterministic(msgs, OPTIONS);

    expect(result.compacted).toBe(true);
    expect(result.droppedMessages).toBe(16); // 8 old turns × 2 messages
    expect(result.messages[0]!.compacted).toBe(true);
    expect(result.estimatedBefore).toBe(before);
    expect(result.estimatedAfter).toBeLessThan(result.estimatedBefore);

    // The last 2 turns must be verbatim at the tail.
    const tail = result.messages.slice(-4);
    expect(tail.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(tail[0]!.content).toContain("question 8");
  });

  test("digest records touched files from tool calls", () => {
    const msgs: Message[] = [
      ...conversation(3),
      {
        role: "assistant",
        content: [{ type: "tool_call", id: "1", name: "edit", arguments: JSON.stringify({ path: "src/foo.ts", hunks: [] }) }],
      },
      ...conversation(3),
    ];
    const result = compactDeterministic(msgs, OPTIONS);
    expect((result.messages[0]!.content as string)).toContain("edit: src/foo.ts");
  });

  test("is a no-op when there is nothing old enough", () => {
    const msgs = conversation(2);
    const result = compactDeterministic(msgs, OPTIONS);
    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(msgs);
  });
});

describe("TokenMeter", () => {
  test("accumulates per-turn usage", () => {
    const meter = new TokenMeter();
    meter.recordTurn({ inputTokens: 100, outputTokens: 20 });
    meter.recordTurn({ inputTokens: 50, outputTokens: 10, cacheReadTokens: 30 });
    const t = meter.totals();
    expect(t.inputTokens).toBe(150);
    expect(t.outputTokens).toBe(30);
    expect(t.cacheReadTokens).toBe(30);
    expect(t.turns).toBe(2);
    expect(meter.lastTurn()!.usage.inputTokens).toBe(50);
  });

  test("estimateTokens is a stable ~4 chars/token heuristic", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
  });
});
