import { z } from "zod";
import type { Tool } from "./registry.ts";
import type { MemoryStore } from "../memory/store.ts";

/** memory tool: save/recall/forget persistent memories. */

const memorySchema = z.object({
  action: z.enum(["save", "recall", "forget", "list"]),
  content: z.string().optional().describe("For save: the fact/preference to remember."),
  kind: z.enum(["fact", "preference", "decision", "note"]).optional().describe("For save: memory kind (default fact)."),
  query: z.string().optional().describe("For recall: what to search for."),
  id: z.string().optional().describe("For forget: memory id."),
});

export function makeMemoryTool(store: MemoryStore, project: string | null): Tool<z.infer<typeof memorySchema>> {
  return {
    name: "memory",
    summary: "Save, recall, or forget persistent memories.",
    description:
      "Long-term memory across sessions. Save durable facts, user preferences, and decisions — " +
      "not transient task state. Recall searches by keyword overlap and returns only relevant matches. " +
      "Memories are recalled automatically when relevant; use this tool to manage them explicitly.",
    keywords: ["memory", "remember", "recall", "forget", "preference", "fact"],
    readOnly: false,
    schema: memorySchema,
    async execute(input) {
      switch (input.action) {
        case "save": {
          if (!input.content) return "save requires content";
          const mem = store.save({
            kind: input.kind ?? "fact",
            content: input.content,
            project,
          });
          return `Saved memory ${mem.id}: ${mem.content}`;
        }
        case "recall": {
          if (!input.query) return "recall requires query";
          const results = store.recall(input.query, 5, project);
          if (!results.length) return "No matching memories.";
          return results.map((m) => `[${m.id}] (${m.kind}) ${m.content}`).join("\n");
        }
        case "forget": {
          if (!input.id) return "forget requires id";
          return store.forget(input.id) ? `Forgot ${input.id}` : `No memory ${input.id}`;
        }
        case "list": {
          const all = store.list(project, 50);
          if (!all.length) return "No memories stored.";
          return all.map((m) => `[${m.id}] (${m.kind}) ${m.content}`).join("\n");
        }
      }
    },
  };
}
