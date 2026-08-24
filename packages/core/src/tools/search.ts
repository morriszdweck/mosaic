import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { Tool } from "./registry.ts";
import { truncateMiddle } from "./truncate.ts";

/**
 * glob + grep, implemented in pure TS (no ripgrep dependency).
 * Both respect a .gitignore-lite skip list and hard result caps.
 */

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "coverage",
  "target",
  "__pycache__",
  ".venv",
]);

const MAX_RESULTS = 500;
const MAX_FILE_SIZE = 2_000_000; // don't grep files >2MB

/** Convert a glob pattern (with ** and *) to a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more path segments
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

async function walk(root: string, onFile: (abs: string, rel: string) => Promise<boolean | void>): Promise<void> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) stack.push(abs);
      } else if (entry.isFile()) {
        const cont = await onFile(abs, rel);
        if (cont === false) return;
      }
    }
  }
}

const globSchema = z.object({
  pattern: z.string().describe("Glob pattern, e.g. \"src/**/*.ts\" or \"*.md\"."),
  path: z.string().optional().describe("Directory to search (default: cwd)."),
});

export const globTool: Tool<z.infer<typeof globSchema>> = {
  name: "glob",
  summary: "Find files matching a glob pattern.",
  description:
    "Find files by glob pattern (supports ** and *). Skips node_modules/.git/build dirs. " +
    "Returns up to 500 relative paths, sorted. Cheaper than bash find/ls for exploration.",
  keywords: ["glob", "find", "files", "list", "search files", "pattern"],
  readOnly: true,
  schema: globSchema,
  async execute(input, ctx) {
    const root = resolve(ctx.cwd, input.path ?? ".");
    const re = globToRegExp(input.pattern);
    const matches: string[] = [];
    await walk(root, async (_abs, rel) => {
      if (re.test(rel)) {
        matches.push(rel);
        if (matches.length >= MAX_RESULTS) return false;
      }
    });
    matches.sort();
    const suffix = matches.length >= MAX_RESULTS ? `\n(capped at ${MAX_RESULTS} results)` : "";
    return matches.length ? matches.join("\n") + suffix : `No files matching ${input.pattern}`;
  },
};

const grepSchema = z.object({
  pattern: z.string().describe("Regular expression to search for."),
  path: z.string().optional().describe("File or directory to search (default: cwd)."),
  glob: z.string().optional().describe("Only search files matching this glob, e.g. \"*.ts\"."),
  context_lines: z.number().optional().describe("Lines of context around each match (default 0)."),
  case_insensitive: z.boolean().optional().describe("Case-insensitive search."),
  max_results: z.number().optional().describe("Max matching lines to return (default 100)."),
});

export const grepTool: Tool<z.infer<typeof grepSchema>> = {
  name: "grep",
  summary: "Search file contents with a regex.",
  description:
    "Regex search over file contents, like ripgrep. Returns matching lines as `path:line: content`. " +
    "Use glob to limit file types and context_lines for surrounding context. Results are capped; " +
    "narrow the pattern or path when capped. Skips binary-looking and >2MB files.",
  keywords: ["grep", "search", "regex", "find in files", "occurrences"],
  readOnly: true,
  schema: grepSchema,
  async execute(input, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(input.pattern, input.case_insensitive ? "gi" : "g");
    } catch (error) {
      return `Invalid regex: ${error instanceof Error ? error.message : String(error)}`;
    }

    const target = resolve(ctx.cwd, input.path ?? ".");
    const globRe = input.glob ? globToRegExp(input.glob) : null;
    const maxResults = Math.min(input.max_results ?? 100, MAX_RESULTS);
    const contextLines = input.context_lines ?? 0;

    const out: string[] = [];
    let resultCount = 0;

    const searchFile = async (abs: string, rel: string): Promise<boolean | void> => {
      if (globRe && !globRe.test(rel)) return;
      const info = await stat(abs).catch(() => null);
      if (!info || info.size > MAX_FILE_SIZE) return;
      const content = await readFile(abs, "utf8").catch(() => null);
      if (content === null || content.includes("\0")) return; // skip binary-looking

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (!re.test(lines[i]!)) continue;
        for (let c = Math.max(0, i - contextLines); c <= Math.min(lines.length - 1, i + contextLines); c++) {
          const prefix = c === i ? `${rel}:${c + 1}:` : `${rel}:${c + 1}-`;
          out.push(`${prefix} ${lines[c]}`);
        }
        resultCount++;
        if (resultCount >= maxResults) return false;
      }
    };

    const info = await stat(target).catch(() => null);
    if (!info) return `Path not found: ${input.path ?? "."}`;
    if (info.isFile()) {
      await searchFile(target, relative(ctx.cwd, target).split(sep).join("/"));
    } else {
      await walk(target, searchFile);
    }

    if (!out.length) return `No matches for /${input.pattern}/`;
    const capped = truncateMiddle(out.join("\n"), { maxChars: ctx.outputLimit });
    return capped.text + (resultCount >= maxResults ? `\n(capped at ${maxResults} matches)` : "");
  },
};
