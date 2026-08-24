import type {
  ChatRequest,
  ContentPart,
  Message,
  Provider,
  StreamEvent,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  Usage,
} from "../types.ts";

/**
 * OpenAI-compatible provider: covers OpenAI, OpenRouter, Groq, Ollama,
 * LM Studio, and any base-URL endpoint exposing POST /chat/completions.
 *
 * Streams via SSE and normalizes to StreamEvents.
 */

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** Extra headers, e.g. OpenRouter's HTTP-Referer. */
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.extraHeaders = options.headers ?? {};
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async *chat(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = {
      model: request.model,
      messages: toOpenAIMessages(request),
      tools: request.tools.length
        ? request.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          }))
        : undefined,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
      stream_options: { include_usage: true },
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) {
      yield { type: "error", error: new Error(`${this.name} API error ${res.status}: ${await res.text()}`) };
      return;
    }
    if (!res.body) {
      yield { type: "error", error: new Error(`${this.name} API returned no body`) };
      return;
    }

    // tool call accumulator: index → {id, name, arguments}
    const pending = new Map<number, ToolCallPart & { started: boolean }>();

    for await (const data of parseSSE(res.body, request.signal)) {
      if (data === "[DONE]") break;
      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(data) as OpenAIChunk;
      } catch {
        continue; // tolerate keep-alive comments / partial frames
      }

      if (chunk.usage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
          } satisfies Usage,
        };
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta ?? {};
      if (delta.content) yield { type: "text_delta", text: delta.content };

      for (const tc of delta.tool_calls ?? []) {
        let entry = pending.get(tc.index);
        if (!entry) {
          entry = {
            type: "tool_call",
            id: tc.id ?? `call_${tc.index}`,
            name: tc.function?.name ?? "",
            arguments: "",
            started: false,
          };
          pending.set(tc.index, entry);
        }
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name && !entry.started) {
          entry.name = tc.function.name;
          entry.started = true;
          yield { type: "tool_call_start", id: entry.id, name: entry.name };
        }
        if (tc.function?.arguments) {
          entry.arguments += tc.function.arguments;
          yield { type: "tool_call_delta", id: entry.id, argumentsDelta: tc.function.arguments };
        }
      }

      if (choice.finish_reason) {
        for (const entry of pending.values()) yield { type: "tool_call_end", id: entry.id };
        yield {
          type: "done",
          stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
        };
      }
    }
  }
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** Normalize internal messages into OpenAI's wire format. */
export function toOpenAIMessages(request: ChatRequest): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (request.system) out.push({ role: "system", content: request.system });

  for (const message of request.messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const parts = message.content as ContentPart[];
    const text = parts.filter((p): p is TextPart => p.type === "text").map((p) => p.text).join("");
    const calls = parts.filter((p): p is ToolCallPart => p.type === "tool_call");
    const results = parts.filter((p): p is ToolResultPart => p.type === "tool_result");

    if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.length
          ? calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: c.arguments },
            }))
          : undefined,
      });
    } else if (message.role === "tool") {
      for (const r of results) {
        out.push({ role: "tool", tool_call_id: r.toolCallId, content: r.content });
      }
    } else {
      out.push({ role: message.role, content: text });
    }
  }
  return out;
}

/** Incremental SSE parser: yields the `data:` payloads of an event stream. */
export async function* parseSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Reads race against the abort signal so an interrupted stream can't hang.
  const read = () =>
    new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("The operation was aborted.", "AbortError"));
      signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), {
        once: true,
      });
      reader.read().then(resolve, reject);
    });

  try {
    for (;;) {
      const { done, value } = await read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data:")) {
            yield line.slice(5).trimStart();
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
