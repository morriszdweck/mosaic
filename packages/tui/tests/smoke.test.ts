import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { StatusBar } from "../src/components/StatusBar.tsx";

// NOTE: bun test bypasses the Solid JSX plugin for test files, so we invoke
// components directly (they're plain functions) instead of using JSX here.

test("StatusBar renders model, context %, tokens, cost", async () => {
  const { captureCharFrame, renderOnce } = await testRender(
    () =>
      StatusBar({
        model: "openai:gpt-4o-mini",
        contextTokens: 12_800,
        contextWindow: 128_000,
        inputTokens: 1500,
        outputTokens: 300,
        cacheReadTokens: 0,
        cost: 0.0004,
        running: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    { width: 80, height: 3 },
  );
  await renderOnce();
  const frame = captureCharFrame();
  expect(frame).toContain("openai:gpt-4o-mini");
  expect(frame).toContain("10%");
  // Context usage also renders as a meter, filled proportionally.
  expect(frame).toContain("█░░░░░░░");
  expect(frame).toContain("↑1.5k");
  expect(frame).toContain("↓300");
});
