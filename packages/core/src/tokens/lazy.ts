import type { Tool, ToolRegistry } from "../tools/registry.ts";
import type { ToolDefinition } from "../types.ts";

/**
 * Lazy tool schemas: heavy tool descriptions are held back unless relevant.
 * A cheap keyword router scores the conversation so far against each tool's
 * keyword list; tools that score (plus always-on core tools) get their full
 * description, everything else ships as a one-line summary.
 */

const ALWAYS_FULL = new Set(["bash", "read", "write", "edit", "todo"]);

export function routeToolSchemas(
  registry: ToolRegistry,
  recentText: string,
  lazy: boolean,
): ToolDefinition[] {
  if (!lazy) return registry.definitions(false);

  const text = recentText.toLowerCase();
  const expanded: string[] = [];
  const rest: Tool[] = [];

  for (const tool of registry.all()) {
    if (ALWAYS_FULL.has(tool.name) || tool.keywords.some((k) => text.includes(k.toLowerCase()))) {
      expanded.push(tool.name);
    } else {
      rest.push(tool);
    }
  }

  return [
    ...registry.expand(expanded),
    ...rest.map((t) => ({
      name: t.name,
      description: t.summary,
      inputSchema: (t.schema && safeJsonSchema(t)) as Record<string, unknown>,
    })),
  ];
}

import { zodToJsonSchema } from "../util/jsonschema.ts";

function safeJsonSchema(tool: Tool): unknown {
  try {
    return zodToJsonSchema(tool.schema);
  } catch {
    return { type: "object" };
  }
}
