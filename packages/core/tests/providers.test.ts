import { describe, expect, test } from "bun:test";
import { OpenAICompatibleProvider, toOpenAIMessages, parseSSE } from "../src/providers/openai.ts";
import { AnthropicProvider, toAnthropicMessages } from "../src/providers/anthropic.ts";
import { parseModelRef } from "../src/providers/registry.ts";
import type { Message, StreamEvent } from "../src/types.ts";

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new TextEncoder().encode(body));
}

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("OpenAI-compatible provider (mocked fetch)", () => {
  test("streams text and usage", async () => {
    const fetchFn = (async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
        JSON.stringify({ choices: [{ delta: { content: " world" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      ])) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({ name: "test", baseUrl: "http://x/v1", fetchFn });
    const events = await collect(provider.chat({ model: "m", messages: [{ role: "user", content: "hi" }], tools: [] }));

    const text = events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("Hello world");
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ type: "usage", usage: { inputTokens: 10, outputTokens: 2 } });
    expect(events.some((e) => e.type === "done" && e.stopReason === "end_turn")).toBe(true);
  });

  test("reassembles streamed tool calls", async () => {
    const fetchFn = (async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read" } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"pa" } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "th\":\"x\"}" } }] } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ])) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({ name: "test", baseUrl: "http://x/v1", fetchFn });
    const events = await collect(provider.chat({ model: "m", messages: [], tools: [] }));

    expect(events).toContainEqual({ type: "tool_call_start", id: "call_1", name: "read" });
    const deltas = events
      .filter((e) => e.type === "tool_call_delta")
      .map((e) => (e as { argumentsDelta: string }).argumentsDelta)
      .join("");
    expect(deltas).toBe('{"path":"x"}');
    expect(events.some((e) => e.type === "done" && e.stopReason === "tool_use")).toBe(true);
  });
});

describe("Anthropic provider (mocked fetch)", () => {
  test("streams text, tool use, usage with cache fields", async () => {
    const frames = [
      JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 50, cache_read_input_tokens: 40 } } }),
      JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sure." } }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "bash" } }),
      JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"command\":\"ls\"}" } }),
      JSON.stringify({ type: "content_block_stop", index: 1 }),
      JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } }),
    ];
    const fetchFn = (async () => new Response(new TextEncoder().encode(frames.map((f) => `data: ${f}\n\n`).join("")))) as unknown as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "k", fetchFn });
    const events = await collect(provider.chat({ model: "claude", messages: [], tools: [{ name: "bash", description: "", inputSchema: {} }] }));

    expect(events).toContainEqual({ type: "text_delta", text: "Sure." });
    expect(events).toContainEqual({ type: "tool_call_start", id: "toolu_1", name: "bash" });
    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents[0]).toMatchObject({ usage: { inputTokens: 50, cacheReadTokens: 40 } });
    expect(events.some((e) => e.type === "done" && e.stopReason === "tool_use")).toBe(true);
  });
});

describe("message normalization", () => {
  const messages: Message[] = [
    { role: "user", content: "read foo.ts" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Reading it." },
        { type: "tool_call", id: "c1", name: "read", arguments: '{"path":"foo.ts"}' },
      ],
    },
    { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read", content: "file contents" }] },
  ];

  test("OpenAI wire format", () => {
    const out = toOpenAIMessages({ messages, tools: [], model: "m", system: "sys" });
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1]).toEqual({ role: "user", content: "read foo.ts" });
    expect(out[2]).toMatchObject({ role: "assistant", content: "Reading it." });
    expect((out[2]!.tool_calls as unknown[]).length).toBe(1);
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "file contents" });
  });

  test("Anthropic wire format", () => {
    const out = toAnthropicMessages({ messages, tools: [], model: "m" });
    expect(out[0]).toEqual({ role: "user", content: "read foo.ts" });
    expect(out[1]!.role).toBe("assistant");
    const blocks = out[1]!.content as Array<Record<string, unknown>>;
    expect(blocks[1]).toMatchObject({ type: "tool_use", id: "c1", name: "read", input: { path: "foo.ts" } });
    expect(out[2]!.role).toBe("user");
    const results = out[2]!.content as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "c1", content: "file contents" });
  });
});

describe("parseModelRef", () => {
  test.each([
    ["anthropic:claude-sonnet-4-5", { provider: "anthropic", model: "claude-sonnet-4-5" }],
    ["openai:gpt-4o", { provider: "openai", model: "gpt-4o" }],
    ["claude-3-5-sonnet", { provider: "anthropic", model: "claude-3-5-sonnet" }],
    ["gpt-4o", { provider: "openai", model: "gpt-4o" }],
    ["llama3.1", { provider: "ollama", model: "llama3.1" }],
    ["mistral-large", { provider: "ollama", model: "mistral-large" }],
  ])("%s → %o", (input, expected) => {
    expect(parseModelRef(input)).toEqual(expected);
  });
});

describe("parseSSE", () => {
  test("handles frames split across chunks", async () => {
    const chunks = ["data: {\"a\":1}\n\nda", "ta: {\"b\":2}\n\n"];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const data of parseSSE(stream)) out.push(data);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });
});
