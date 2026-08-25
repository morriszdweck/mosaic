/**
 * TUI state model: the chat is a list of entries; streaming appends to the
 * current assistant entry; tool calls get collapsible panels.
 */

export interface UserEntry {
  kind: "user";
  text: string;
}

export interface AssistantEntry {
  kind: "assistant";
  text: string;
  streaming: boolean;
}

export interface ToolEntry {
  kind: "tool";
  id: string;
  name: string;
  arguments: string;
  result: string;
  isError: boolean;
  collapsed: boolean;
  running: boolean;
}

export interface SystemEntry {
  kind: "system";
  text: string;
}

export interface ErrorEntry {
  kind: "error";
  text: string;
}

export type ChatEntry = UserEntry | AssistantEntry | ToolEntry | SystemEntry | ErrorEntry;

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "model", description: "Switch model — /model <provider:name>, or pick from a list" },
  { name: "theme", description: "Switch theme — /theme <name>, or pick from a list" },
  { name: "sessions", description: "Browse and resume past sessions" },
  { name: "resume", description: "Resume a session by id — /resume <id>" },
  { name: "export", description: "Write this conversation to markdown — /export [path]" },
  { name: "compact", description: "Compact older context now" },
  { name: "clear", description: "Clear the conversation and start a fresh session" },
  { name: "cost", description: "Token usage and cost report" },
  { name: "memory", description: "List persistent memories" },
  { name: "files", description: "Reindex the project files used by @ references" },
  { name: "login", description: "How to add a provider key — /login <provider>" },
  { name: "keys", description: "Keyboard shortcuts" },
  { name: "help", description: "Commands and keys" },
];
