import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { install, isInstalled } from "./installer.ts";
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
 * has seen — which is what binds a task to its session.
 *
 * A **standalone** task has no such binding. It is registered with the
 * operating system's scheduler, and each run starts a fresh Mosaic session in
 * the directory it was created in. That is what "every weekday at 08:00" has to
 * mean: a briefing that only arrives when you already have the app open is not
 * a briefing. Those are run by src/plugin/schedule/runner.ts, out of process.
 */

const POLL_MS = 15_000;

export const SchedulePlugin: Plugin = async ({ client, directory }) => {
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
      heartbeat: tool({
        description: [
          "Start a standing check that runs on an interval until the session ends.",
          "",
          "Each beat arrives as a message in this conversation, so you keep the",
          "context and can compare against what you saw last time. The user can",
          "talk to you normally in between — a beat is just another turn.",
          "",
          "Say what to look at when you start it. A beat that re-reads everything",
          "costs the same every time regardless of whether anything changed, so",
          "prefer a check that can end in 'nothing changed' quickly.",
          "",
          "Runs only while Mosaic is open. One heartbeat per conversation:",
          "starting another replaces it. Stop it when the reason for it is gone.",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["start", "stop", "status"]),
          every: tool.schema.string().optional().describe("For start: '5m', '30m', '2h'. Minimum 1m."),
          watch: tool.schema
            .string()
            .optional()
            .describe("For start: what to check each beat, and what counts as worth reporting."),
        },
        async execute(args, context) {
          live.add(context.sessionID);

          if (args.action === "stop") {
            const stopped = store.stopHeartbeats(context.sessionID);
            return stopped ? "Heartbeat stopped." : "No heartbeat running.";
          }

          if (args.action === "status") {
            const beat = store.heartbeatFor(context.sessionID);
            if (!beat) return "No heartbeat running.";
            return `Heartbeat every ${Math.round((beat.repeat ?? 0) / 60)}m, ${beat.fired} beat(s) so far, next ${describeWhen(beat)}.\nWatching: ${beat.prompt}`;
          }

          if (!args.every || !args.watch) return "Both `every` and `watch` are required to start a heartbeat.";
          let parsed;
          try {
            parsed = parseWhen(`every ${args.every.replace(/^every\s+/i, "")}`);
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
          if (parsed.repeat === null) return "A heartbeat has to repeat — give an interval like '10m'.";

          // One per conversation: two overlapping standing checks in the same
          // context produce interleaved reports nobody can follow.
          const replaced = store.stopHeartbeats(context.sessionID);
          const beat = store.add({
            sessionID: context.sessionID,
            prompt: [
              "[heartbeat] Check the following now and report only what changed or needs attention.",
              "If nothing has changed, say so in one line and stop.",
              "",
              args.watch,
            ].join("\n"),
            dueAt: parsed.dueAt,
            repeat: parsed.repeat,
            when: `every ${args.every}`,
            heartbeat: true,
          });
          return (
            `${replaced ? "Replaced the previous heartbeat. " : ""}` +
            `Heartbeat every ${Math.round(parsed.repeat / 60)}m, first beat ${describeWhen(beat)}.`
          );
        },
      }),

      schedule: tool({
        description: [
          "Schedule a prompt to run later. Two scopes, and picking the right one",
          "is the whole decision:",
          "",
          "scope 'session' (default) — the prompt comes back to you in THIS",
          "conversation, with everything currently in context. Use it for the rest",
          "of what you are doing now: 'check the build again in 10m'. It only",
          "fires while this conversation stays open.",
          "",
          "scope 'standalone' — the prompt runs whether or not Mosaic is open,",
          "started by the operating system's scheduler, in a NEW session in this",
          "directory. Use it for anything on a clock the user expects to keep:",
          "'every weekday at 08:00', 'every Monday at 17:00', 'every day at 09:00'.",
          "It survives quitting Mosaic and rebooting. Because it starts fresh, the",
          "prompt has to stand alone — write it as if to someone who was not here",
          "for this conversation, naming the files, paths, and criteria in full.",
          "",
          "If the user says 'every morning', 'daily', 'each week', or gives a time",
          "of day, they mean standalone. A recurring task that quietly stops the",
          "moment the app closes is worse than telling them it cannot be done.",
          "",
          "add: when = 'in 10m', 'every 2h', 'at 14:30', 'every day at 09:00',",
          "  'every weekday at 08:30', 'every monday at 17:00'",
          "list: pending tasks — this conversation's, and this directory's standing ones",
          "cancel: by id",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["add", "list", "cancel"]),
          when: tool.schema
            .string()
            .optional()
            .describe("For add: 'in 10m', 'every 2h', 'at 14:30', 'every day at 09:00', 'every weekday at 08:30'"),
          prompt: tool.schema
            .string()
            .optional()
            .describe("For add: what to run. Write it as an instruction to act on."),
          scope: tool.schema
            .enum(["session", "standalone"])
            .optional()
            .describe(
              "'session' (default) fires into this conversation while it is open. " +
                "'standalone' runs in a new session whether or not Mosaic is open — use it for anything daily or weekly.",
            ),
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

              const standalone = args.scope === "standalone";
              const task = store.add({
                sessionID: standalone ? "" : context.sessionID,
                scope: standalone ? "standalone" : "session",
                directory: standalone ? directory : "",
                prompt: args.prompt,
                dueAt: parsed.dueAt,
                repeat: parsed.repeat,
                recurrence: parsed.recurrence ?? null,
                when: args.when,
              });
              if (!standalone) return `Scheduled [${task.id}] ${describeWhen(task)}: ${task.prompt}`;

              // Register with the OS scheduler on first use rather than as a
              // setup step. If that fails, say so — a standing task nobody is
              // going to run is worse than an error.
              const lines = [`Scheduled [${task.id}] ${describeWhen(task)}, in ${directory}.`];
              if (!isInstalled()) {
                const result = install();
                lines.push(result.ok ? result.message : `Could not register with the OS scheduler: ${result.message}`);
              }
              lines.push("It runs in its own session, whether or not Mosaic is open.");
              return lines.join("\n");
            }

            case "list": {
              const mine = store.list(context.sessionID);
              const standing = store.listStandalone(directory);
              if (!mine.length && !standing.length) return "Nothing scheduled here.";
              const sections: string[] = [];
              if (mine.length) {
                sections.push(
                  ["In this conversation:", ...mine.map((t) => `[${t.id}] ${describeWhen(t)} — ${t.prompt}`)].join("\n"),
                );
              }
              if (standing.length) {
                sections.push(
                  [
                    "Standing, in this directory (run whether or not Mosaic is open):",
                    ...standing.map(
                      (t) =>
                        `[${t.id}] ${t.when} (${describeWhen(t)}) — ${t.prompt.split("\n")[0]}` +
                        (t.paused ? " — paused" : t.lastStatus ? ` — last run ${t.lastStatus}` : ""),
                    ),
                  ].join("\n"),
                );
              }
              return sections.join("\n\n");
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
