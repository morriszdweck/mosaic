/**
 * Core message/event types shared across providers, tools, and the agent loop.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  /** Raw JSON arguments string as streamed by the provider. */
  arguments: string;
}

export interface ToolResultPart {
  type: "tool_result";
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type ContentPart = TextPart | ToolCallPart | ToolResultPart;

export interface Message {
  role: Role;
  content: string | ContentPart[];
  /** True when this message was produced by compaction (summarized history). */
  compacted?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "unknown" }
  | { type: "error"; error: Error };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  messages: Message[];
  tools: ToolDefinition[];
  system?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Provider-specific extras (e.g. cache control hints). */
  cacheKey?: string;
}

export interface Provider {
  readonly name: string;
  chat(request: ChatRequest): AsyncIterable<StreamEvent>;
}

export interface ModelRef {
  provider: string;
  model: string;
}

export function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function toolCallsOf(message: Message): ToolCallPart[] {
  if (typeof message.content === "string") return [];
  return message.content.filter((p): p is ToolCallPart => p.type === "tool_call");
}

export function toolResultsOf(message: Message): ToolResultPart[] {
  if (typeof message.content === "string") return [];
  return message.content.filter((p): p is ToolResultPart => p.type === "tool_result");
}
