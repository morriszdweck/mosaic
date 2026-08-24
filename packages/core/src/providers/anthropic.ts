import type {
  ChatRequest,
  ContentPart,
  Provider,
  StreamEvent,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "../types.ts";
import { parseSSE } from "./openai.ts";

/**
 * Anthropic Messages API provider (native, streaming, tool use).
 * Marks the system prompt + tool definitions with cache_control so the
 * stable prefix hits Anthropic's prompt cache.
 */

export interface AnthropicOptions {
  baseUrl?: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async *chat(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature,
      stream: true,
      system: request.system
        ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
        : undefined,
      tools: request.tools.length
        ? request.tools.map((t, i) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
            // Cache the tool block: stable across turns, big token saver.
            ...(i === request.tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
          }))
        : undefined,
      messages: toAnthropicMessages(request),
    };

    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) {
      yield { type: "error", error: new Error(`Anthropic API error ${res.status}: ${await res.text()}`) };
      return;
    }
    if (!res.body) {
      yield { type: "error", error: new Error("Anthropic API returned no body") };
      return;
    }

    const blockIndex = new Map<number, string>(); // index → tool call id
    let toolJsonBuffers = new Map<number, string>();

    for await (const data of parseSSE(res.body, request.signal)) {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block?.type === "tool_use") {
            blockIndex.set(event.index!, block.id!);
            toolJsonBuffers.set(event.index!, "");
            yield { type: "tool_call_start", id: block.id!, name: block.name! };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "text_delta" && delta.text) {
            yield { type: "text_delta", text: delta.text };
          } else if (delta?.type === "input_json_delta" && delta.partial_json) {
            const idx = event.index!;
            toolJsonBuffers.set(idx, (toolJsonBuffers.get(idx) ?? "") + delta.partial_json);
            const id = blockIndex.get(idx);
            if (id) yield { type: "tool_call_delta", id, argumentsDelta: delta.partial_json };
          }
          break;
        }
        case "content_block_stop": {
          const id = blockIndex.get(event.index!);
          if (id) yield { type: "tool_call_end", id };
          break;
        }
        case "message_delta": {
          if (event.usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: 0,
                outputTokens: event.usage.output_tokens ?? 0,
              },
            };
          }
          if (event.delta?.stop_reason) {
            yield {
              type: "done",
              stopReason:
                event.delta.stop_reason === "tool_use"
                  ? "tool_use"
                  : event.delta.stop_reason === "max_tokens"
                    ? "max_tokens"
                    : "end_turn",
            };
          }
          break;
        }
        case "message_start": {
          const usage = event.message?.usage;
          if (usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: 0,
                cacheReadTokens: usage.cache_read_input_tokens,
                cacheWriteTokens: usage.cache_creation_input_tokens,
              },
            };
          }
          break;
        }
        case "error": {
          yield { type: "error", error: new Error(event.error?.message ?? "Anthropic stream error") };
          break;
        }
      }
    }
  }
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  error?: { message?: string };
}

/** Normalize internal messages into Anthropic's wire format. */
export function toAnthropicMessages(request: ChatRequest): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const message of request.messages) {
    if (message.role === "system") continue; // passed separately

    if (typeof message.content === "string") {
      out.push({ role: message.role === "tool" ? "user" : message.role, content: message.content });
      continue;
    }

    const parts = message.content as ContentPart[];
    if (message.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      for (const p of parts) {
        if (p.type === "text" && p.text) blocks.push({ type: "text", text: p.text });
        else if (p.type === "tool_call") {
          let input: unknown = {};
          try {
            input = JSON.parse(p.arguments || "{}");
          } catch {
            input = {};
          }
          blocks.push({ type: "tool_use", id: p.id, name: p.name, input });
        }
      }
      out.push({ role: "assistant", content: blocks });
    } else if (message.role === "tool") {
      const blocks = parts
        .filter((p): p is ToolResultPart => p.type === "tool_result")
        .map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolCallId,
          content: r.content,
          is_error: r.isError ?? false,
        }));
      out.push({ role: "user", content: blocks });
    } else {
      const text = parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      out.push({ role: "user", content: text });
    }
  }
  return out;
}
