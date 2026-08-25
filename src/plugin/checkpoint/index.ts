import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { isAbsolute, resolve } from "node:path";
import { CheckpointStore } from "./store.ts";

/**
 * Checkpoints.
 *
 * Before the agent writes to a file for the first time in a turn, its current
 * contents are copied aside. `checkpoint restore` puts them back. The capture
 * is automatic because an undo you have to remember to arm is not an undo.
 *
 * Scoped to files the agent touches rather than whole directories: snapshotting
 * a project on every edit is slow enough that people disable it, and a disabled
 * safety net is worse than an honest absence of one.
 */

/** Tools whose first argument names a file the agent is about to change. */
const WRITES = new Set(["write", "edit", "patch"]);

export const CheckpointPlugin: Plugin = async ({ directory }) => {
  const store = new CheckpointStore();
  /** Checkpoint each session is currently capturing into. */
  const active = new Map<string, number>();

  function checkpointFor(sessionID: string, label: string): number {
    const existing = active.get(sessionID);
    if (existing !== undefined) return existing;
    const created = store.create(sessionID, label, directory);
    active.set(sessionID, created.id);
    return created.id;
  }

  return {
    tool: {
      checkpoint: tool({
        description: [
          "File snapshots taken before you change things, and the way back.",
          "",
          "A checkpoint is created automatically the first time you write to a",
          "file, capturing what was there before. You do not need to arm it.",
          "",
          "list: checkpoints for this directory, newest first",
          "restore: put every file in a checkpoint back as it was",
          "create: start a fresh checkpoint before a risky batch of edits, so the",
          "  way back is to one point rather than a mixture",
          "",
          "Restoring rewrites files on disk. Say what will be affected and get",
          "the user's agreement first unless they asked for it outright.",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["list", "restore", "create", "drop"]),
          id: tool.schema.number().optional().describe("For restore and drop."),
          label: tool.schema.string().optional().describe("For create: what this point is, in a few words."),
        },
        async execute(args, context) {
          switch (args.action) {
            case "create": {
              const created = store.create(context.sessionID, args.label?.trim() || "manual", directory);
              active.set(context.sessionID, created.id);
              return `Checkpoint [${created.id}] "${created.label}" started. Files are captured as you change them.`;
            }

            case "list": {
              const all = store.listForDirectory(directory);
              if (!all.length) return "No checkpoints here yet. One is created the first time a file is written.";
              return all
                .map((c) => {
                  const when = new Date(c.createdAt).toLocaleTimeString();
                  return `[${c.id}] ${when} — ${c.label} (${c.files} file${c.files === 1 ? "" : "s"})`;
                })
                .join("\n");
            }

            case "restore": {
              if (args.id === undefined) return "`id` is required. Use list first.";
              const target = store.get(args.id);
              if (!target || target.directory !== directory) return `No checkpoint [${args.id}] in this directory.`;
              if (target.files === 0) return `Checkpoint [${args.id}] captured no files — nothing to restore.`;

              const result = await store.restore(args.id, directory);
              const lines = [`Restored checkpoint [${args.id}] "${target.label}".`];
              if (result.restored.length) lines.push(`  reverted: ${result.restored.join(", ")}`);
              if (result.removed.length) lines.push(`  removed (did not exist before): ${result.removed.join(", ")}`);
              if (result.failed.length) lines.push(`  could not restore: ${result.failed.join(", ")}`);
              return lines.join("\n");
            }

            case "drop": {
              if (args.id === undefined) return "`id` is required.";
              const target = store.get(args.id);
              if (!target || target.directory !== directory) return `No checkpoint [${args.id}] in this directory.`;
              await store.remove(args.id);
              if (active.get(context.sessionID) === args.id) active.delete(context.sessionID);
              return `Dropped checkpoint [${args.id}].`;
            }
          }
        },
      }),
    },

    /**
     * Capture before the write lands. This runs ahead of the tool, which is the
     * only moment the previous contents still exist.
     */
    "tool.execute.before": async (input, output) => {
      if (!WRITES.has(input.tool)) return;
      const args = (output as { args?: Record<string, unknown> }).args ?? {};
      const named = args.filePath ?? args.path ?? args.file;
      if (typeof named !== "string" || !named) return;

      const absolute = isAbsolute(named) ? named : resolve(directory, named);
      try {
        const id = checkpointFor(input.sessionID, "before edits");
        await store.capture(id, absolute, directory);
      } catch {
        // A failed capture must never block the edit the user asked for.
      }
    },

    dispose: async () => store.close(),
  };
};

export default CheckpointPlugin;
