import { z } from "zod";
import type { Tool } from "./registry.ts";

/**
 * todo: lightweight task tracking surfaced in the TUI sidebar.
 * State lives per-session in memory (not persisted) — it's a working set.
 */

export interface TodoItem {
  id: number;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export class TodoList {
  private items: TodoItem[] = [];
  private nextId = 1;

  set(items: Array<{ content: string; status: TodoItem["status"] }>): void {
    this.items = items.map((i, idx) => ({ id: idx + 1, content: i.content, status: i.status }));
    this.nextId = this.items.length + 1;
  }

  get(): TodoItem[] {
    return this.items;
  }

  render(): string {
    if (!this.items.length) return "(no tasks)";
    const icon = { pending: "○", in_progress: "◐", completed: "●" } as const;
    return this.items.map((i) => `${icon[i.status]} ${i.id}. ${i.content} — ${i.status}`).join("\n");
  }
}

const todoSchema = z.object({
  items: z
    .array(
      z.object({
        content: z.string().describe("Task description."),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    )
    .describe("The full task list (replaces the current list)."),
});

export function makeTodoTool(list: TodoList): Tool<z.infer<typeof todoSchema>> {
  return {
    name: "todo",
    summary: "Update the session task list (full replacement).",
    description:
      "Track multi-step work. Pass the complete list each time: mark items in_progress before starting, " +
      "completed immediately when done. Keep exactly one item in_progress. Skip for trivial single-step tasks.",
    keywords: ["todo", "task", "plan", "steps", "checklist"],
    readOnly: true,
    schema: todoSchema,
    async execute(input) {
      list.set(input.items);
      return list.render();
    },
  };
}
