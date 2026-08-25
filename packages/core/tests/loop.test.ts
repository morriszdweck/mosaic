import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent } from "../src/agent/loop.ts";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.ts";
import { PermissionGate } from "../src/permissions.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { readTool, editTool, writeTool } from "../src/tools/files.ts";
import { globTool, grepTool } from "../src/tools/search.ts";
import { bashTool } from "../src/tools/bash.ts";
import { TodoList, makeTodoTool } from "../src/tools/todo.ts";
import { routeToolSchemas } from "../src/tokens/lazy.ts";
import type { StreamEvent } from "../src/types.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mosaic-e2e-"));
  process.env.MOSAIC_HOME = join(dir, ".mosaic");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new TextEncoder().encode(body));
}

function textChunk(text: string) {
  return { choices: [{ delta: { content: text } }] };
}
function doneChunk(reason: string) {
  return { choices: [{ delta: {}, finish_reason: reason }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of [readTool, writeTool, editTool, globTool, grepTool, bashTool, makeTodoTool(new TodoList())]) {
    registry.register(t);
  }
  return registry;
}

describe("agent loop E2E (mock provider)", () => {
  test("streams answer, dispatches a tool, loops to final answer", async () => {
    await writeFile(join(dir, "hello.txt"), "file says hi");

    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls === 1) {
        // Turn 1: assistant requests a read tool call.
        return sse([
          textChunk("Let me check. "),
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read", arguments: JSON.stringify({ path: "hello.txt" }) } }] } }] },
          doneChunk("tool_calls"),
        ]);
      }
      // Turn 2: final answer after seeing the tool result.
      return sse([textChunk("The file says hi."), doneChunk("stop")]);
    }) as unknown as typeof fetch;

    const config = structuredClone(DEFAULT_CONFIG);
    config.model = "openai:test-model";
    const agent = new Agent({
      config,
      registry: makeRegistry(),
      permissionGate: new PermissionGate({ mode: "ask" }, []),
      memory: null,
      todo: new TodoList(),
      cwd: dir,
      fetchFn,
    });

    const events: StreamEvent[] = [];
    const agentEvents: string[] = [];
    let finalText = "";
    for await (const event of agent.run("what does hello.txt say?")) {
      agentEvents.push(event.type);
      if (event.type === "text") finalText += event.text;
    }

    expect(calls).toBe(2);
    expect(finalText).toBe("Let me check. The file says hi.");
    expect(agentEvents).toContain("tool_start");
    expect(agentEvents).toContain("tool_result");
    expect(agentEvents).toContain("usage");
    expect(agentEvents[agentEvents.length - 1]).toBe("turn_end");

    // The transcript holds the full structure: user, assistant(+call), tool result, assistant.
    const roles = agent.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    // Token meter recorded both LLM calls.
    expect(agent.meter.totals().turns).toBe(2);
    expect(agent.meter.totals().inputTokens).toBe(20);
  });

  test("interrupt aborts mid-turn and salvages partial text", async () => {
    const fetchFn = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(textChunk("partial"))}\n\n`));
          // never finishes; the abort will cut it off
          await new Promise(() => {});
        },
      });
      return new Response(stream);
    }) as unknown as typeof fetch;

    const config = structuredClone(DEFAULT_CONFIG);
    config.model = "openai:test-model";
    const agent = new Agent({
      config,
      registry: makeRegistry(),
      permissionGate: new PermissionGate({ mode: "ask" }, []),
      memory: null,
      todo: new TodoList(),
      cwd: dir,
      fetchFn,
    });

    setTimeout(() => agent.interrupt(), 50);
    let text = "";
    let interrupted = false;
    for await (const event of agent.run("tell a long story")) {
      if (event.type === "text") text += event.text;
      if (event.type === "interrupted") interrupted = true;
    }
    expect(interrupted).toBe(true);
    expect(text).toBe("partial");
    // partial assistant text salvaged into context
    expect(agent.messages[agent.messages.length - 1]).toMatchObject({ role: "assistant", content: "partial" });
  });

  test("redirect queue continues from the same context", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return sse([textChunk(calls === 1 ? "first answer" : "second answer"), doneChunk("stop")]);
    }) as unknown as typeof fetch;

    const config = structuredClone(DEFAULT_CONFIG);
    config.model = "openai:test-model";
    const agent = new Agent({
      config,
      registry: makeRegistry(),
      permissionGate: new PermissionGate({ mode: "ask" }, []),
      memory: null,
      todo: new TodoList(),
      cwd: dir,
      fetchFn,
    });
    agent.queueRedirect("follow-up question");
    let text = "";
    for await (const event of agent.run("initial question")) {
      if (event.type === "text") text += event.text;
    }
    expect(text).toBe("first answersecond answer");
    expect(calls).toBe(2);
    expect(agent.messages.filter((m) => m.role === "user").length).toBe(2);
  });
});

describe("lazy tool schema router", () => {
  test("expands tools whose keywords appear in recent text", () => {
    const registry = makeRegistry();
    const defs = routeToolSchemas(registry, "summarize this document for me", true);
    const byName = new Map(defs.map((d) => [d.name, d.description]));
    // always-full tools
    expect(byName.get("read")).toContain("\n");
    // lazy tool not mentioned → summary only
    expect(byName.get("grep")).not.toContain("\n");
    expect(byName.get("web_search")).toBeUndefined(); // not registered here — but glob is
    expect(byName.get("glob")).not.toContain("\n");
  });

  test("non-lazy mode expands everything", () => {
    const registry = makeRegistry();
    const defs = routeToolSchemas(registry, "anything", false);
    for (const d of defs) expect(d.description).toContain("\n");
  });
});

describe("config loading", () => {
  test("defaults work with no config file", async () => {
    const cfg = await loadConfig(join(dir, "nowhere"));
    expect(cfg.model).toBe("openai:gpt-4o-mini");
    expect(cfg.tokens.compactAt).toBe(0.8);
  });
});
