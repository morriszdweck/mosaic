import type { ZodType } from "zod";
import { zodToJsonSchema } from "../util/jsonschema.ts";
import type { ToolDefinition } from "../types.ts";

/**
 * Tool registry: zod-validated schemas, per-tool output caps, and lazy-schema
 * metadata so heavy descriptions can be held back until relevant.
 */

export interface ToolContext {
  cwd: string;
  /** Per-tool output cap in characters. */
  outputLimit: number;
  signal?: AbortSignal;
  /** Ask the user before running a sensitive action. Returns true if approved. */
  requestPermission: (tool: string, detail: string) => Promise<boolean>;
  /** Services injected by the agent runtime (memory, sessions, subagent runner...). */
  services: Record<string, unknown>;
}

export interface Tool<TInput = unknown> {
  name: string;
  /** One-line summary — always eligible for the system prompt. */
  summary: string;
  /** Full description — only injected when lazy-schema routing selects the tool. */
  description: string;
  schema: ZodType<TInput>;
  /** Heuristic keywords used by the lazy-schema router. */
  keywords: string[];
  /** Tools marked read-only never ask for permission in allow-read-only mode. */
  readOnly: boolean;
  /** Override the default output cap. */
  outputLimit?: number;
  execute(input: TInput, ctx: ToolContext): Promise<string>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * Produce wire-format tool definitions.
   * @param lazy when true, heavy descriptions are replaced by the one-line summary;
   *             the agent loop combines this with keyword routing to decide when
   *             the full description is worth the tokens.
   */
  definitions(lazy: boolean): ToolDefinition[] {
    return this.all().map((t) => ({
      name: t.name,
      description: lazy ? t.summary : `${t.summary}\n\n${t.description}`,
      inputSchema: zodToJsonSchema(t.schema) as Record<string, unknown>,
    }));
  }

  /** Full definitions for only the named tools (lazy-schema expansion). */
  expand(names: string[]): ToolDefinition[] {
    return names
      .map((n) => this.tools.get(n))
      .filter((t): t is Tool => t !== undefined)
      .map((t) => ({
        name: t.name,
        description: `${t.summary}\n\n${t.description}`,
        inputSchema: zodToJsonSchema(t.schema) as Record<string, unknown>,
      }));
  }
}
