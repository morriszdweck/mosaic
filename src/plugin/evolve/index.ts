import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Self-modification: the agent's own identity and its skills.
 *
 * Two things Mosaic can change about itself between conversations — the SOUL.md
 * that shapes how it talks, and the skills it can load on demand. Both are
 * plain markdown the user can read and edit, which is the point: an agent that
 * rewrites itself into a file nobody can inspect is not something to hand
 * someone.
 *
 * Neither takes effect until Mosaic restarts. Config is read once at startup,
 * so a tool that claimed otherwise would be lying.
 */

const MOSAIC_HOME = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
const SOUL = join(MOSAIC_HOME, "SOUL.md");
const SKILLS = join(MOSAIC_HOME, "config", "opencode", "skill");

/** Skills Mosaic installs itself; editing them would be undone on next launch. */
const MANAGED = new Set(["agent-swarm", "customize-mosaic", "mosaic-self"]);

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const EvolvePlugin: Plugin = async () => {
  return {
    tool: {
      soul: tool({
        description: [
          "Read or rewrite SOUL.md — the file that shapes how you talk and what",
          "you assume about the user across every conversation.",
          "",
          "Put durable things here: what to call them, tone, standing preferences,",
          "conventions they have asked for more than once. Not facts about a",
          "project (use `memory`) and not anything specific to today.",
          "",
          "Rewriting replaces the whole file, so read it first and preserve what",
          "still applies. Ask before changing it unless the user asked you to —",
          "it is their voice, not yours. Takes effect on the next start.",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["read", "write"]),
          content: tool.schema.string().optional().describe("For write: the complete new SOUL.md."),
        },
        async execute(args) {
          if (args.action === "read") {
            if (!existsSync(SOUL)) return "No SOUL.md yet. Write one to give Mosaic a standing voice.";
            return await readFile(SOUL, "utf8");
          }
          if (!args.content?.trim()) return "`content` is required, and replaces the whole file.";
          await mkdir(MOSAIC_HOME, { recursive: true });
          await writeFile(SOUL, args.content.trimEnd() + "\n");
          return `Wrote ${SOUL}. It applies from the next start.`;
        },
      }),

      skill: tool({
        description: [
          "Write a skill: a markdown document you can load on demand later.",
          "",
          "Write one when you have worked something out that will come up again —",
          "a procedure, a house style, the shape of a recurring task. The point is",
          "that the detail stays out of context until it is needed, so put the",
          "trigger in the description and the detail in the body.",
          "",
          "The description decides whether the skill is ever found. Say what it",
          "does and when to use it, front-loading the words the user would say.",
          "",
          "Takes effect on the next start. Skills Mosaic ships are read-only here",
          "— a copy would be overwritten on the next launch anyway.",
        ].join("\n"),
        args: {
          action: tool.schema.enum(["list", "read", "write", "delete"]),
          name: tool.schema.string().optional().describe("lowercase-with-hyphens, e.g. weekly-report"),
          description: tool.schema
            .string()
            .optional()
            .describe("For write: what it does AND when to use it. This is what makes it findable."),
          content: tool.schema.string().optional().describe("For write: the body, in markdown."),
        },
        async execute(args) {
          switch (args.action) {
            case "list": {
              if (!existsSync(SKILLS)) return "No skills written yet.";
              const names = (await readdir(SKILLS)).filter((n) => !n.startsWith("."));
              if (!names.length) return "No skills written yet.";
              return names.map((n) => (MANAGED.has(n) ? `${n} (built in)` : n)).join("\n");
            }

            case "read": {
              if (!args.name) return "`name` is required.";
              const path = join(SKILLS, args.name, "SKILL.md");
              if (!existsSync(path)) return `No skill "${args.name}".`;
              return await readFile(path, "utf8");
            }

            case "write": {
              if (!args.name || !args.description || !args.content) {
                return "`name`, `description`, and `content` are all required.";
              }
              if (!NAME.test(args.name)) {
                return `"${args.name}" is not a valid name. Use lowercase words joined by hyphens.`;
              }
              if (MANAGED.has(args.name)) {
                return `"${args.name}" ships with Mosaic and is rewritten on each launch. Pick another name.`;
              }
              const dir = join(SKILLS, args.name);
              await mkdir(dir, { recursive: true });
              const body = [
                "---",
                `name: ${args.name}`,
                `description: ${args.description.replace(/\n/g, " ").trim()}`,
                "---",
                "",
                args.content.trimEnd(),
                "",
              ].join("\n");
              await writeFile(join(dir, "SKILL.md"), body);
              return `Wrote skill "${args.name}". It becomes loadable on the next start.`;
            }

            case "delete": {
              if (!args.name) return "`name` is required.";
              if (MANAGED.has(args.name)) return `"${args.name}" ships with Mosaic and cannot be deleted here.`;
              const dir = join(SKILLS, args.name);
              if (!existsSync(dir)) return `No skill "${args.name}".`;
              await rm(dir, { recursive: true, force: true });
              return `Deleted skill "${args.name}".`;
            }
          }
        },
      }),
    },
  };
};

export default EvolvePlugin;
