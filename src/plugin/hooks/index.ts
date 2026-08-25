import type { Plugin } from "@opencode-ai/plugin";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Event hooks: user code that runs at points in a turn.
 *
 * Drop a `.ts` or `.js` file in `~/.mosaic/hooks/` exporting any of the
 * handlers below, and Mosaic calls it. This is the guardrail seam — refuse a
 * command, log what ran, notify on completion — without writing a plugin or
 * knowing the engine's API.
 *
 *   // ~/.mosaic/hooks/no-force-push.ts
 *   export function beforeTool({ tool, args, deny }) {
 *     if (tool === "bash" && String(args.command).includes("push --force")) {
 *       deny("force pushes are blocked by a local hook")
 *     }
 *   }
 *
 * A hook that throws is reported and skipped rather than taking the turn down
 * with it: a broken logging hook should not stop you working. `deny` is the
 * exception — it is the hook doing its job, and it stops the tool.
 */

export interface BeforeToolEvent {
  tool: string;
  sessionID: string;
  args: Record<string, unknown>;
  /** Refuse the call. The reason is shown to the agent in place of a result. */
  deny: (reason: string) => void;
}

export interface AfterToolEvent {
  tool: string;
  sessionID: string;
  args: Record<string, unknown>;
  title: string;
  output: string;
}

export interface MessageEvent {
  sessionID: string;
  text: string;
}

export interface HookModule {
  beforeTool?: (event: BeforeToolEvent) => void | Promise<void>;
  afterTool?: (event: AfterToolEvent) => void | Promise<void>;
  onMessage?: (event: MessageEvent) => void | Promise<void>;
}

class HookDenied extends Error {}

export function hooksDir(home = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic")): string {
  return join(home, "hooks");
}

/** Load every hook module, skipping ones that fail to import. */
export async function loadHooks(dir = hooksDir()): Promise<Array<{ name: string; module: HookModule }>> {
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; module: HookModule }> = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.startsWith(".")).sort();
  } catch {
    return [];
  }
  for (const name of names) {
    try {
      const module = (await import(join(dir, name))) as HookModule & { default?: HookModule };
      out.push({ name, module: module.default ?? module });
    } catch (error) {
      process.stderr.write(`mosaic: hook ${name} failed to load: ${error instanceof Error ? error.message : error}\n`);
    }
  }
  return out;
}

export const HooksPlugin: Plugin = async () => {
  const hooks = await loadHooks();
  if (!hooks.length) return {};

  /** Run one handler across every hook, letting a denial through. */
  async function run<E>(pick: (m: HookModule) => ((event: E) => void | Promise<void>) | undefined, event: E) {
    for (const { name, module } of hooks) {
      const handler = pick(module);
      if (!handler) continue;
      try {
        await handler(event);
      } catch (error) {
        if (error instanceof HookDenied) throw error;
        // One broken hook must not break the turn.
        process.stderr.write(`mosaic: hook ${name} threw: ${error instanceof Error ? error.message : error}\n`);
      }
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      await run<BeforeToolEvent>((m) => m.beforeTool, {
        tool: input.tool,
        sessionID: input.sessionID,
        args: (output.args ?? {}) as Record<string, unknown>,
        deny: (reason: string) => {
          throw new HookDenied(reason || `blocked by a local hook`);
        },
      });
    },

    "tool.execute.after": async (input, output) => {
      await run<AfterToolEvent>((m) => m.afterTool, {
        tool: input.tool,
        sessionID: input.sessionID,
        args: {},
        title: (output as { title?: string }).title ?? "",
        output: (output as { output?: string }).output ?? "",
      });
    },

    "chat.message": async (_input, output) => {
      const text = output.parts
        .filter((p): p is typeof p & { text: string } => p.type === "text" && "text" in p)
        .map((p) => p.text)
        .join(" ");
      if (text.trim()) await run<MessageEvent>((m) => m.onMessage, { sessionID: "", text });
    },
  };
};

export default HooksPlugin;
