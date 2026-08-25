import type { MosaicConfig } from "../config.ts";
import type { MemoryStore } from "../memory/store.ts";
import { loadProjectMemory } from "../memory/project.ts";
import { listSkills } from "../memory/skills.ts";
import { PermissionGate, type PermissionPrompt } from "../permissions.ts";
import { resolveProvider } from "../providers/registry.ts";
import type { Message, ToolCallPart, Usage } from "../types.ts";
import { textOf } from "../types.ts";
import type { ToolRegistry, ToolContext } from "../tools/registry.ts";
import type { SubagentRunner } from "../tools/agent.ts";
import { compactWithSummary, needsCompaction, type CompactionOptions } from "../tokens/compact.ts";
import { estimateContextTokens, TokenMeter } from "../tokens/meter.ts";
import { routeToolSchemas } from "../tokens/lazy.ts";
import { truncateMiddle } from "../tools/truncate.ts";
import { backgroundTasks } from "../tools/bash.ts";
import { TodoList } from "../tools/todo.ts";

/**
 * The Mosaic agent loop:
 *   stream LLM → dispatch tool calls → append results → repeat until stop.
 * Interruptible: abort mid-turn, then queue a redirect message that continues
 * from the same context. Subagents run the same loop in isolated context.
 */

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; name: string; result: string; isError: boolean }
  | { type: "compaction"; droppedMessages: number; estimatedBefore: number; estimatedAfter: number }
  | { type: "usage"; usage: Usage; totals: ReturnType<TokenMeter["totals"]> }
  | { type: "turn_end" }
  | { type: "interrupted" }
  | { type: "error"; error: Error };

export interface AgentOptions {
  config: MosaicConfig;
  registry: ToolRegistry;
  permissionGate: PermissionGate;
  memory: MemoryStore | null;
  todo: TodoList;
  cwd: string;
  model?: string;
  maxTurns?: number;
  fetchFn?: typeof fetch;
  /** Interactive permission prompt (TUI provides; headless defaults to allow-once). */
  permissionPrompt?: PermissionPrompt;
  /** Nesting depth for subagents (0 = main agent). Subagents capped at depth 1. */
  depth?: number;
}

const MAX_LOOP_TURNS = 25;

export class Agent {
  readonly config: MosaicConfig;
  readonly meter = new TokenMeter();
  readonly messages: Message[] = [];
  private readonly options: AgentOptions;
  private abortController: AbortController | null = null;
  private redirectQueue: string[] = [];
  private systemPrompt: string | null = null;
  private running = false;

  constructor(options: AgentOptions) {
    this.options = options;
    this.config = options.config;
  }

  get model(): string {
    return this.options.model ?? this.config.model;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Interrupt the current turn (Esc). In-flight tool calls are aborted. */
  interrupt(): void {
    this.abortController?.abort();
  }

  /** Queue a redirect: delivered as the next user message after interruption. */
  queueRedirect(message: string): void {
    this.redirectQueue.push(message);
  }

  /** Stable system prompt — prefix ordering optimized for provider prompt caches. */
  async buildSystemPrompt(): Promise<string> {
    if (this.systemPrompt) return this.systemPrompt;

    const sections: string[] = [];
    sections.push(
      [
        "You are Mosaic, a terminal AI coding agent.",
        "Be concise and direct. Prefer tools over prose for facts about the filesystem, web, or memory.",
        "Use read/grep/glob instead of bash cat/grep/find — they are cheaper and safer.",
        "Prefer edit over write when changing existing files.",
        "Delegate open-ended exploration to the agent tool to keep this context small.",
      ].join("\n"),
    );

    // Project memory (MOSAIC.md / AGENTS.md), size-capped.
    const projectFiles = await loadProjectMemory(this.options.cwd, this.config.memory.projectFileCap);
    for (const file of projectFiles) {
      sections.push(`# Project memory (${file.path})${file.truncated ? " [truncated]" : ""}\n${file.content}`);
    }

    // Available skills: names + summaries only.
    const skills = await listSkills(this.options.cwd);
    if (skills.length) {
      sections.push(
        "# Available skills (invoke with the skill tool)\n" +
          skills.map((s) => `- ${s.name}: ${s.summary}`).join("\n"),
      );
    }

    // Environment last: it changes, so it goes after cacheable content.
    sections.push(
      `# Environment\nWorking directory: ${this.options.cwd}\nDate: ${new Date().toISOString().slice(0, 10)}`,
    );

    this.systemPrompt = sections.join("\n\n");
    return this.systemPrompt;
  }

  /** Run one user turn (which may span several LLM calls for tool use). */
  async *run(userMessage: string): AsyncIterable<AgentEvent> {
    if (this.running) throw new Error("Agent is already running a turn");
    this.running = true;
    this.abortController = new AbortController();

    try {
      this.messages.push({ role: "user", content: userMessage });
      yield* this.loop();
      // Deliver queued redirects as follow-up turns in the same context.
      while (this.redirectQueue.length && !this.abortController.signal.aborted) {
        const next = this.redirectQueue.shift()!;
        this.messages.push({ role: "user", content: next });
        yield* this.loop();
      }
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  private async *loop(): AsyncIterable<AgentEvent> {
    const signal = this.abortController!.signal;
    const { provider, warning } = this.resolve();
    if (warning) yield { type: "error", error: new Error(warning) };

    const system = await this.buildSystemPrompt();

    for (let turn = 0; turn < (this.options.maxTurns ?? MAX_LOOP_TURNS); turn++) {
      if (signal.aborted) {
        yield { type: "interrupted" };
        return;
      }

      // Auto-compaction at ~80% context.
      const compactionOpts: CompactionOptions = {
        contextWindow: this.config.tokens.contextWindow,
        compactAt: this.config.tokens.compactAt,
        keepLastTurns: this.config.tokens.keepLastTurns,
      };
      if (needsCompaction(system, this.messages, compactionOpts)) {
        const small = this.resolve(this.config.smallModel);
        const result = await compactWithSummary(this.messages, compactionOpts, small.provider, small.ref.model);
        if (result.compacted) {
          this.messages.length = 0;
          this.messages.push(...result.messages);
          yield {
            type: "compaction",
            droppedMessages: result.droppedMessages,
            estimatedBefore: result.estimatedBefore,
            estimatedAfter: result.estimatedAfter,
          };
        }
      }

      // Lazy tool schemas: route on the recent conversation text.
      const recentText = this.messages
        .slice(-6)
        .map((m) => textOf(m))
        .join("\n");
      const tools = routeToolSchemas(this.options.registry, recentText, this.config.tokens.lazyToolSchemas);

      // Stream one LLM call, accumulating text + tool calls.
      let assistantText = "";
      const toolCalls = new Map<string, ToolCallPart>();
      let stopReason: string = "end_turn";

      try {
        for await (const event of provider.chat({
          messages: this.messages,
          tools,
          system,
          model: this.resolve().ref.model,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
          signal,
        })) {
          switch (event.type) {
            case "text_delta":
              assistantText += event.text;
              yield { type: "text", text: event.text };
              break;
            case "tool_call_start":
              toolCalls.set(event.id, { type: "tool_call", id: event.id, name: event.name, arguments: "" });
              break;
            case "tool_call_delta": {
              const call = toolCalls.get(event.id);
              if (call) call.arguments += event.argumentsDelta;
              break;
            }
            case "tool_call_end":
              break;
            case "usage":
              this.meter.recordTurn(event.usage);
              yield { type: "usage", usage: event.usage, totals: this.meter.totals() };
              break;
            case "done":
              stopReason = event.stopReason;
              break;
            case "error":
              yield { type: "error", error: event.error };
              return;
          }
        }
      } catch (error) {
        if (signal.aborted) {
          // Salvage partial output so context stays coherent after Esc.
          if (assistantText) this.messages.push({ role: "assistant", content: assistantText });
          yield { type: "interrupted" };
          return;
        }
        yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
        return;
      }

      // Append the assistant message (text + tool calls).
      const content: Message["content"] = [];
      if (assistantText) content.push({ type: "text", text: assistantText });
      for (const call of toolCalls.values()) content.push(call);
      if (content.length) this.messages.push({ role: "assistant", content });

      // No tool calls → turn complete.
      if (stopReason !== "tool_use" || !toolCalls.size) {
        yield { type: "turn_end" };
        return;
      }

      // Dispatch tool calls sequentially (keeps transcript ordering simple).
      const results: Message["content"] = [];
      for (const call of toolCalls.values()) {
        yield { type: "tool_start", id: call.id, name: call.name, arguments: call.arguments };
        const result = await this.dispatchTool(call, signal);
        results.push({
          type: "tool_result",
          toolCallId: call.id,
          name: call.name,
          content: result.result,
          isError: result.isError,
        });
        yield { type: "tool_result", id: call.id, name: call.name, result: result.result, isError: result.isError };
        if (signal.aborted) {
          if (results.length) this.messages.push({ role: "tool", content: results });
          yield { type: "interrupted" };
          return;
        }
      }
      this.messages.push({ role: "tool", content: results });
    }

    yield { type: "error", error: new Error(`Reached max loop turns (${this.options.maxTurns ?? MAX_LOOP_TURNS})`) };
  }

  private resolve(modelString?: string) {
    return resolveProvider(modelString ?? this.model, this.config, this.options.fetchFn);
  }

  /**
   * Why the active model cannot be used, or undefined if it can. Lets a front
   * end say "no key for X" at startup instead of at the first failed request.
   */
  authWarning(modelString?: string): string | undefined {
    return this.resolve(modelString).warning;
  }

  private async dispatchTool(
    call: ToolCallPart,
    signal: AbortSignal,
  ): Promise<{ result: string; isError: boolean }> {
    const tool = this.options.registry.get(call.name);
    if (!tool) return { result: `Unknown tool: ${call.name}`, isError: true };

    let parsed: unknown;
    try {
      parsed = tool.schema.parse(JSON.parse(call.arguments || "{}"));
    } catch (error) {
      return {
        result: `Invalid arguments for ${call.name}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    const detail = describeCall(call);
    const approved = await this.options.permissionGate.check(
      call.name,
      tool.readOnly,
      detail,
      async (t, d) => {
        const prompt = this.options.permissionPrompt;
        return prompt ? prompt(t, d) : "allow-once";
      },
    );
    if (!approved) return { result: `Permission denied for ${call.name}.`, isError: true };

    const ctx: ToolContext = {
      cwd: this.options.cwd,
      outputLimit: tool.outputLimit ?? this.config.tools.outputLimit,
      signal,
      requestPermission: async (t, d) => this.options.permissionGate.check(t, false, d, this.options.permissionPrompt ?? (async () => "allow-once")),
      services: {
        bashTimeoutMs: this.config.tools.bashTimeoutMs,
        searchConfig: this.config.search,
        todo: this.options.todo,
        memory: this.options.memory,
        subagentRunner: this.makeSubagentRunner(),
        backgroundTasks,
      },
    };

    try {
      const raw = await tool.execute(parsed, ctx);
      const capped = truncateMiddle(raw, { maxChars: tool.outputLimit ?? this.config.tools.outputLimit });
      return { result: capped.text, isError: false };
    } catch (error) {
      if (signal.aborted) return { result: "(aborted)", isError: true };
      return { result: `Tool error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }

  /** Subagent runner: isolated context, same tools (minus agent at max depth), only conclusion returns. */
  private makeSubagentRunner(): SubagentRunner | undefined {
    if ((this.options.depth ?? 0) >= 1) return undefined;
    return {
      run: async (task, opts) => {
        const sub = new Agent({
          ...this.options,
          model: this.config.smallModel || this.model,
          maxTurns: opts.maxTurns ?? 12,
          depth: (this.options.depth ?? 0) + 1,
        });
        // Give the subagent a clean system prompt (no cached one from parent).
        let report = "";
        try {
          for await (const event of sub.run(task)) {
            if (event.type === "text") report += event.text;
            if (event.type === "error") report += `\n[subagent error: ${event.error.message}]`;
          }
        } catch (error) {
          report += `\n[subagent failed: ${error instanceof Error ? error.message : String(error)}]`;
        }
        return report || "(subagent returned nothing)";
      },
    };
  }
}

function describeCall(call: ToolCallPart): string {
  try {
    const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    if (typeof args.command === "string") return `${call.name}: ${args.command.slice(0, 200)}`;
    if (typeof args.path === "string") return `${call.name}: ${args.path}`;
    if (typeof args.pattern === "string") return `${call.name}: /${args.pattern}/`;
    if (typeof args.url === "string") return `${call.name}: ${args.url}`;
  } catch {
    // fall through
  }
  return call.name;
}
