/**
 * @mosaic/core — agent loop, tool registry, providers, memory, sessions.
 * No UI dependencies; the TUI and CLI build on this.
 */

export * from "./types.ts";
export { loadConfig, resolveApiKey, DEFAULT_CONFIG } from "./config.ts";
export type { MosaicConfig } from "./config.ts";
export { AuthStore } from "./auth/store.ts";
export type { Credential, OAuthCredential, ApiKeyCredential } from "./auth/store.ts";
export { requestDeviceCode, pollForToken, refreshToken, isExpired, DEFAULT_CODEX_OAUTH } from "./auth/codex.ts";
export { OpenAICompatibleProvider, parseSSE } from "./providers/openai.ts";
export { AnthropicProvider } from "./providers/anthropic.ts";
export { CodexProvider, OpenCodeProvider } from "./providers/codex.ts";
export { resolveProvider, parseModelRef } from "./providers/registry.ts";
export { ToolRegistry } from "./tools/registry.ts";
export type { Tool, ToolContext } from "./tools/registry.ts";
export { truncateMiddle, windowLines } from "./tools/truncate.ts";
export { bashTool, taskOutputTool, taskKillTool, backgroundTasks, BackgroundTaskManager } from "./tools/bash.ts";
export { readTool, writeTool, editTool } from "./tools/files.ts";
export { globTool, grepTool, globToRegExp } from "./tools/search.ts";
export { webFetchTool, webSearchTool, htmlToText } from "./tools/web.ts";
export { makeTodoTool, TodoList } from "./tools/todo.ts";
export type { TodoItem } from "./tools/todo.ts";
export { makeMemoryTool } from "./tools/memory.ts";
export { skillTool } from "./tools/skill.ts";
export { agentTool } from "./tools/agent.ts";
export type { SubagentRunner } from "./tools/agent.ts";
export { PermissionGate } from "./permissions.ts";
export type { PermissionDecision, PermissionPrompt } from "./permissions.ts";
export { MemoryStore, tokenize, extractKeywords } from "./memory/store.ts";
export type { Memory } from "./memory/store.ts";
export { loadProjectMemory } from "./memory/project.ts";
export { listSkills, loadSkill } from "./memory/skills.ts";
export type { Skill } from "./memory/skills.ts";
export { SessionStore } from "./session/store.ts";
export type { SessionMeta } from "./session/store.ts";
export { TokenMeter, estimateTokens, estimateMessageTokens, estimateContextTokens } from "./tokens/meter.ts";
export { needsCompaction, compactDeterministic, compactWithSummary, findKeepIndex } from "./tokens/compact.ts";
export type { CompactionOptions, CompactionResult } from "./tokens/compact.ts";
export { routeToolSchemas } from "./tokens/lazy.ts";
export { Agent } from "./agent/loop.ts";
export type { AgentEvent, AgentOptions } from "./agent/loop.ts";
export { McpClient, mcpTools } from "./mcp/client.ts";
export type { McpServerConfig } from "./mcp/client.ts";
export { createAgentRuntime } from "./runtime.ts";
export type { AgentRuntime, RuntimeOptions } from "./runtime.ts";
export { parseToml, mergeToml } from "./util/toml.ts";
export { zodToJsonSchema } from "./util/jsonschema.ts";
export { newId } from "./util/ids.ts";
export * as paths from "./util/paths.ts";
