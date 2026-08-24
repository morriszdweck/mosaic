import { z } from "zod";
import type { Tool } from "../tools/registry.ts";

/**
 * MCP client: connect to external tool servers over stdio (JSON-RPC 2.0).
 * Discovered tools are wrapped as Mosaic tools and registered under
 * `mcp__<server>__<tool>` names.
 */

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private proc: Bun.Subprocess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";

  constructor(private readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    this.proc = Bun.spawn([this.config.command, ...(this.config.args ?? [])], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, ...(this.config.env ?? {}) },
    });

    void this.readLoop();

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mosaic", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  private async readLoop(): Promise<void> {
    if (!this.proc?.stdout || typeof this.proc.stdout === "number") return;
    const decoder = new TextDecoder();
    const reader = this.proc.stdout.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });
      let idx: number;
      // MCP over stdio: newline-delimited JSON-RPC.
      while ((idx = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined) {
            const waiter = this.pending.get(msg.id);
            if (waiter) {
              this.pending.delete(msg.id);
              if (msg.error) waiter.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
              else waiter.resolve(msg.result);
            }
          }
        } catch {
          // ignore non-JSON noise on stdout
        }
      }
    }
  }

  private write(message: JsonRpcRequest | { jsonrpc: "2.0"; method: string; params?: unknown }): void {
    if (!this.proc?.stdin || typeof this.proc.stdin === "number") throw new Error("MCP server not connected");
    this.proc.stdin.write(JSON.stringify(message) + "\n");
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timed out: ${method}`));
      }, 30_000);
    });
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    const result = (await this.request("tools/list", {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
    if (result.isError) throw new Error(text || "MCP tool error");
    return text || "(no output)";
  }

  close(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

/** Wrap MCP tools as Mosaic tools. */
export function mcpTools(client: McpClient, serverName: string, defs: Awaited<ReturnType<McpClient["listTools"]>>): Tool[] {
  return defs.map((def) => ({
    name: `mcp__${serverName}__${def.name}`,
    summary: def.description?.split("\n")[0]?.slice(0, 120) ?? `MCP tool ${def.name} from ${serverName}`,
    description: def.description ?? `MCP tool ${def.name} from server ${serverName}`,
    keywords: [serverName, def.name],
    readOnly: false,
    schema: jsonSchemaToZodPassthrough(def.inputSchema),
    execute: async (input) => client.callTool(def.name, input as Record<string, unknown>),
  }));
}

/**
 * We can't faithfully reconstruct zod from arbitrary JSON Schema; use a
 * permissive record schema and pass arguments through untouched.
 */
function jsonSchemaToZodPassthrough(_schema: Record<string, unknown> | undefined): z.ZodType<unknown> {
  return z.record(z.unknown()) as unknown as z.ZodType<unknown>;
}
