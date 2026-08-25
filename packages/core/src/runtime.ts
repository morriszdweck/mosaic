import { Agent, type AgentOptions } from "./agent/loop.ts";
import type { MosaicConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { AuthStore } from "./auth/store.ts";
import { MemoryStore } from "./memory/store.ts";
import { PermissionGate, type PermissionPrompt } from "./permissions.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { agentTool } from "./tools/agent.ts";
import { bashTool, taskKillTool, taskOutputTool } from "./tools/bash.ts";
import { editTool, readTool, writeTool } from "./tools/files.ts";
import { skillTool } from "./tools/skill.ts";
import { globTool, grepTool } from "./tools/search.ts";
import { makeMemoryTool } from "./tools/memory.ts";
import { makeTodoTool, TodoList } from "./tools/todo.ts";
import { webFetchTool, webSearchTool } from "./tools/web.ts";
import { McpClient, mcpTools, type McpServerConfig } from "./mcp/client.ts";

/**
 * Assemble a fully wired Agent: config, stores, registry with all built-ins,
 * permission gate, and MCP servers. Shared by the CLI headless mode and TUI.
 */

export interface RuntimeOptions {
  cwd: string;
  model?: string;
  config?: MosaicConfig;
  permissionPrompt?: PermissionPrompt;
  fetchFn?: typeof fetch;
  /** MCP servers to connect (from config). Failures degrade gracefully. */
  mcpServers?: McpServerConfig[];
  withMemory?: boolean;
}

export interface AgentRuntime {
  agent: Agent;
  config: MosaicConfig;
  registry: ToolRegistry;
  todo: TodoList;
  memory: MemoryStore | null;
  authStore: AuthStore;
  mcpClients: McpClient[];
  close: () => void;
}

export async function createAgentRuntime(options: RuntimeOptions): Promise<AgentRuntime> {
  const config = options.config ?? (await loadConfig(options.cwd));
  const authStore = new AuthStore();
  // Saved `mosaic login --key` credentials are only reachable through the async
  // store, but provider resolution is synchronous — load them once, here.
  config.storedKeys = { ...config.storedKeys, ...(await authStore.apiKeys()) };
  const withMemory = options.withMemory ?? config.memory.enabled;
  const memory = withMemory ? await MemoryStore.create() : null;

  const todo = new TodoList();
  const registry = new ToolRegistry();
  for (const tool of [
    bashTool,
    taskOutputTool,
    taskKillTool,
    readTool,
    writeTool,
    editTool,
    globTool,
    grepTool,
    webFetchTool,
    webSearchTool,
    makeTodoTool(todo),
    skillTool,
    agentTool,
  ]) {
    registry.register(tool);
  }
  if (memory) registry.register(makeMemoryTool(memory, options.cwd));

  const gate = new PermissionGate(config.permissions, config.tools.alwaysAsk);

  const agentOptions: AgentOptions = {
    config,
    registry,
    permissionGate: gate,
    memory,
    todo,
    cwd: options.cwd,
    model: options.model,
    fetchFn: options.fetchFn,
    permissionPrompt: options.permissionPrompt,
  };
  const agent = new Agent(agentOptions);

  // MCP servers: connect best-effort, register discovered tools.
  const mcpClients: McpClient[] = [];
  for (const server of options.mcpServers ?? []) {
    const client = new McpClient(server);
    try {
      await client.connect();
      const defs = await client.listTools();
      for (const tool of mcpTools(client, server.name, defs)) registry.register(tool);
      mcpClients.push(client);
    } catch {
      // Server unavailable — skip it rather than failing the session.
    }
  }

  return {
    agent,
    config,
    registry,
    todo,
    memory,
    authStore,
    mcpClients,
    close: () => {
      for (const c of mcpClients) c.close();
      memory?.close();
    },
  };
}
