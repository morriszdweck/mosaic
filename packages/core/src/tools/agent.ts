import { z } from "zod";
import type { Tool } from "./registry.ts";

/**
 * agent tool: spawn a subagent with isolated context — the big token saver.
 * Exploration/search happens in the subagent; only its conclusion returns
 * to the main context. The runner is injected by the agent loop to avoid
 * a circular import.
 */

export interface SubagentRunner {
  run(task: string, options: { maxTurns?: number; signal?: AbortSignal }): Promise<string>;
}

const agentSchema = z.object({
  task: z
    .string()
    .describe(
      "Complete, self-contained task for the subagent. It has no access to this conversation — " +
        "include all necessary context, file paths, and what to report back.",
    ),
  max_turns: z.number().optional().describe("Max agent-loop turns (default 12)."),
});

export const agentTool: Tool<z.infer<typeof agentSchema>> = {
  name: "agent",
  summary: "Spawn a subagent with isolated context; only its conclusion returns.",
  description:
    "Delegate multi-step exploration, research, or search to a subagent. It runs the full tool set in its " +
    "own context window and returns only a final report — intermediate reads/searches never touch your " +
    "context. Ideal for: 'find how X works', 'survey files matching Y', open-ended investigation. " +
    "The task must be fully self-contained: the subagent sees nothing of this conversation.",
  keywords: ["subagent", "delegate", "explore", "investigate", "survey"],
  readOnly: true,
  outputLimit: 10_000,
  schema: agentSchema,
  async execute(input, ctx) {
    const runner = ctx.services.subagentRunner as SubagentRunner | undefined;
    if (!runner) return "Subagents are not available in this context.";
    return runner.run(input.task, { maxTurns: input.max_turns ?? 12, signal: ctx.signal });
  },
};
