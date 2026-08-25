import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { describeWhen, parseWhen, TaskStore } from "./store.ts";

/**
 * Scheduled tasks.
 *
 * The agent can ask for a prompt to be handed back to it later, in the session
 * it was scheduled from. When the time comes the prompt is submitted as a real
 * message, so the run happens with the conversation already in place rather
 * than in a fresh context that has to be re-briefed.
 *
 * The timer lives here, in the server process, and only fires for sessions it
 * has seen — which is what binds a task to its session. A task therefore fires
 * only while Mosaic is running; that limit is stated in the tool description
 * rather than papered over, because an agent that promises a 3am reminder from
 * a closed laptop is worse than one that says it cannot.
 */

const POLL_MS = 15_000;

export const SchedulePlugin: Plugin = async ({ client }) => {
  const store = new TaskStore();
  /** Sessions seen this run — the only ones we may submit into. */
  const live = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Guard against a slow run overlapping the next poll. */
  let firing = false;

  async function fireDue(): Promise<void> {
    if (firing) return;
    firing = true;
    try {
      for (const sessionID of live) {
        for (const task of store.due(sessionID)) {
          // Record first: a task that fails to submit must not be retried on
          // every poll forever.
          store.recordFired(task.id);
          try {
            await client.session.promptAsync({
              path: { id: sessionID },
              body: {
                parts: [{ type: "text", text: task.prompt }],
              },
            });
          } catch {
            // The session may have been deleted. Nothing useful to report to a
            // conversation that is gone.
            live.delete(sessionID);
          }
        }
      }
    } finally {
      firing = false;
    }
  }

  timer = setInterval(() => void fireDue(), POLL_MS);
  // Never hold the process open on account of the scheduler.
  timer.unref?.();

  return {
    tool: {
      schedule: tool({
        description: [
          "Schedule a prompt to be sent back to you later, in this conversation.",
          "",
          "When it fires you receive it as a normal message, with this conversation",
          "already in context — so schedule the instruction, not a re-explanation.",
          "",
          "Only fires while Mosaic is running. If the user needs something to happen",
          "whether or not Mosaic is open, tell them to use cron with `mosaic run`",
          "instead of scheduling it here.",
          "",
          "add: when = 'in 10m', 'every 2h', 'at 14:30'",
          "list: pending tasks for this conversation",
          "cancel: by id",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["add", "list", "cancel"]),
          when: tool.schema.string().optional().describe("For add: 'in 10m', 'every 2h', 'at 14:30'"),
          prompt: tool.schema
            .string()
            .optional()
            .describe("For add: what to send yourself. Write it as an instruction to act on."),
          id: tool.schema.number().optional().describe("For cancel."),
        },
        async execute(args, context) {
          live.add(context.sessionID);

          switch (args.action) {
            case "add": {
              if (!args.when || !args.prompt) return "Both `when` and `prompt` are required.";
              let parsed;
              try {
                parsed = parseWhen(args.when);
              } catch (error) {
                return error instanceof Error ? error.message : String(error);
              }
              const task = store.add({
                sessionID: context.sessionID,
                prompt: args.prompt,
                dueAt: parsed.dueAt,
                repeat: parsed.repeat,
                when: args.when,
              });
              return `Scheduled [${task.id}] ${describeWhen(task)}: ${task.prompt}`;
            }

            case "list": {
              const tasks = store.list(context.sessionID);
              if (!tasks.length) return "Nothing scheduled in this conversation.";
              return tasks.map((t) => `[${t.id}] ${describeWhen(t)} — ${t.prompt}`).join("\n");
            }

            case "cancel": {
              if (args.id === undefined) return "`id` is required.";
              return store.cancel(args.id) ? `Cancelled [${args.id}].` : `No pending task [${args.id}].`;
            }
          }
        },
      }),
    },

    // Track which sessions are live so a task only fires into a conversation
    // this process is actually serving.
    "chat.message": async (input) => {
      if (input.sessionID) live.add(input.sessionID);
    },

    dispose: async () => {
      if (timer) clearInterval(timer);
      store.close();
    },
  };
};

export default SchedulePlugin;
