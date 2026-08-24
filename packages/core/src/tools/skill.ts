import { z } from "zod";
import type { Tool } from "./registry.ts";
import { loadSkill } from "../memory/skills.ts";
import { truncateMiddle } from "./truncate.ts";

/**
 * skill tool: invoke a SKILL.md skill. Only names+summaries sit in the
 * system prompt; the body loads into context on demand.
 */

const skillSchema = z.object({
  name: z.string().describe("Skill name (from the available skills list)."),
});

export const skillTool: Tool<z.infer<typeof skillSchema>> = {
  name: "skill",
  summary: "Load and invoke a skill (SKILL.md) by name.",
  description:
    "Load the full instructions of an available skill into context, then follow them for the current task. " +
    "Use whenever a task matches a skill's description — the skill body is loaded on demand to save tokens.",
  keywords: ["skill", "capability", "specialized", "workflow"],
  readOnly: true,
  schema: skillSchema,
  async execute(input, ctx) {
    const skill = await loadSkill(ctx.cwd, input.name);
    if (!skill) return `No skill named "${input.name}". Check the available skills list in the system prompt.`;
    const capped = truncateMiddle(skill.body, { maxChars: ctx.outputLimit });
    return `# Skill: ${skill.name}\n# Location: ${skill.dir}\n\n${capped.text}\n\n[Skill loaded — follow these instructions for the current task.]`;
  },
};
