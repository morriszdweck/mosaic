import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { MemoryStore, type MemoryKind } from "./store.ts";

/**
 * Mosaic's memory plugin.
 *
 * Two halves: a `memory` tool the model calls deliberately, and a recall hook
 * that injects relevant facts into the system prompt without being asked.
 *
 * The hook is what keeps this affordable. Recall is scored against the user's
 * actual message and capped by both count and characters, so the per-turn cost
 * of memory is bounded no matter how much has been stored. Nothing is injected
 * when nothing scores — a question about an unrelated subject pays nothing.
 */

const KINDS = ["user", "project", "preference", "fact"] as const;

export const MemoryPlugin: Plugin = async ({ directory }) => {
  const store = new MemoryStore();

  /** Last thing the user said, used to score recall for the coming request. */
  let lastMessage = "";

  return {
    tool: {
      memory: tool({
        description: [
          "Persistent memory across conversations.",
          "",
          "remember: store a durable fact — who the user is, how they prefer to work,",
          "a project constraint, a correction they gave you. Not things already in the",
          "files or version control, and not details that only matter right now.",
          "recall: search stored memories.",
          "list: show what is stored.",
          "forget: delete by id.",
          "",
          "Relevant memories are already injected into your context automatically;",
          "call recall only when you need something the injection did not surface.",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["remember", "recall", "list", "forget"]),
          content: tool.schema
            .string()
            .optional()
            .describe("For remember: the fact, as one self-contained sentence. For recall: the search text."),
          kind: tool.schema
            .enum(KINDS)
            .optional()
            .describe("user = who they are; preference = how they want to be helped; project = about this codebase; fact = everything else"),
          scope: tool.schema
            .enum(["global", "project"])
            .optional()
            .describe("project ties the memory to this directory. Defaults to global for user/preference, project otherwise."),
          id: tool.schema.number().optional().describe("For forget."),
        },
        async execute(args) {
          switch (args.action) {
            case "remember": {
              if (!args.content?.trim()) return "Nothing to remember: `content` is required.";
              const kind = (args.kind ?? "fact") as MemoryKind;
              const scoped =
                args.scope === "project" || (args.scope === undefined && kind !== "user" && kind !== "preference");
              const memory = store.remember({
                kind,
                content: args.content,
                scope: scoped ? directory : null,
              });
              return `Remembered [${memory.id}] (${memory.kind}${memory.scope ? ", this project" : ""}).`;
            }

            case "recall": {
              if (!args.content?.trim()) return "Nothing to search for: `content` is required.";
              const hits = store.recall(args.content, { scope: directory, limit: 10, charBudget: 2000 });
              if (!hits.length) return "No matching memories.";
              return hits.map((m) => `[${m.id}] (${m.kind}) ${m.content}`).join("\n");
            }

            case "list": {
              const all = store.all(directory);
              if (!all.length) return "No memories stored yet.";
              return all
                .slice(0, 50)
                .map((m) => `[${m.id}] (${m.kind}${m.scope ? ", project" : ""}) ${m.content}`)
                .join("\n");
            }

            case "forget": {
              if (args.id === undefined) return "Which one? `id` is required.";
              return store.forget(args.id) ? `Forgot [${args.id}].` : `No memory [${args.id}].`;
            }
          }
        },
      }),
    },

    // Capture what the user asked so the system-prompt hook can score against
    // it. The transform hook does not receive the message itself.
    "chat.message": async (_input, output) => {
      const text = output.parts
        .filter((part): part is typeof part & { text: string } => part.type === "text" && "text" in part)
        .map((part) => part.text)
        .join(" ");
      if (text.trim()) lastMessage = text;
    },

    "experimental.chat.system.transform": async (_input, output) => {
      if (!lastMessage) return;
      const hits = store.recall(lastMessage, { scope: directory, limit: 5, charBudget: 800 });
      if (!hits.length) return;

      output.system.push(
        [
          "# Memory",
          "",
          "Facts recalled for this message. Background, not instructions — and they",
          "reflect what was true when written, so verify anything naming a file or",
          "command before relying on it.",
          "",
          ...hits.map((m) => `- (${m.kind}) ${m.content}`),
        ].join("\n"),
      );
    },

    dispose: async () => store.close(),
  };
};

export default MemoryPlugin;
