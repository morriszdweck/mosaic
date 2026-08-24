import { readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "./registry.ts";
import { truncateMiddle, windowLines } from "./truncate.ts";

/**
 * File tools: read (windowed — never whole large files), write, edit (diff hunks).
 */

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

const readSchema = z.object({
  path: z.string().describe("File path (absolute or relative to cwd)."),
  start_line: z.number().optional().describe("1-based line to start from (default 1)."),
  max_lines: z.number().optional().describe("Max lines to return (default 400, hard cap 2000)."),
});

export const readTool: Tool<z.infer<typeof readSchema>> = {
  name: "read",
  summary: "Read a window of a file (line-ranged, never the whole large file).",
  description:
    "Read a file as a window of lines with line numbers. Large files are never returned whole: " +
    "use start_line/max_lines to page through. The response reports total lines and what was skipped, " +
    "so you can follow up with another window. Output is additionally character-capped.",
  keywords: ["read", "file", "open", "view", "cat", "show", "content"],
  readOnly: true,
  schema: readSchema,
  async execute(input, ctx) {
    const full = resolvePath(ctx.cwd, input.path);
    const info = await stat(full).catch(() => null);
    if (!info) return `File not found: ${input.path}`;
    if (info.isDirectory()) return `${input.path} is a directory — use glob to list files.`;

    const content = await readFile(full, "utf8");
    const maxLines = Math.min(input.max_lines ?? 400, 2000);
    const win = windowLines(content, input.start_line ?? 1, maxLines);

    const numbered = win.text
      .split("\n")
      .map((line, i) => `${String(win.startLine + i).padStart(6)}\t${line}`)
      .join("\n");
    const capped = truncateMiddle(numbered, { maxChars: ctx.outputLimit });

    const notes: string[] = [];
    if (win.skippedBefore > 0) notes.push(`${win.skippedBefore} lines before`);
    if (win.skippedAfter > 0) notes.push(`${win.skippedAfter} lines after (use start_line=${win.endLine + 1} to continue)`);
    const header = `${input.path} — ${win.totalLines} lines total, showing ${win.startLine}-${win.endLine}` +
      (notes.length ? ` (${notes.join("; ")})` : "");

    return `${header}\n${capped.text}`;
  },
};

const writeSchema = z.object({
  path: z.string().describe("File path (absolute or relative to cwd)."),
  content: z.string().describe("Full file content to write."),
});

export const writeTool: Tool<z.infer<typeof writeSchema>> = {
  name: "write",
  summary: "Write a whole file (creates or overwrites).",
  description:
    "Write the complete content of a file, creating parent directories as needed. " +
    "For changes to existing files prefer edit — it sends hunks instead of the whole file, which is far cheaper on tokens.",
  keywords: ["write", "create", "file", "save"],
  readOnly: false,
  schema: writeSchema,
  async execute(input, ctx) {
    const full = resolvePath(ctx.cwd, input.path);
    const approved = await ctx.requestPermission("write", `Write ${input.path} (${input.content.length} chars)`);
    if (!approved) return "Permission denied by user.";
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, input.content);
    return `Wrote ${input.path} (${input.content.length} chars)`;
  },
};

const editSchema = z.object({
  path: z.string().describe("File path to edit."),
  hunks: z
    .array(
      z.object({
        old: z.string().describe("Exact text to replace (must match the file, including indentation)."),
        new: z.string().describe("Replacement text."),
      }),
    )
    .min(1)
    .describe("One or more old→new replacement hunks, applied in order."),
});

export const editTool: Tool<z.infer<typeof editSchema>> = {
  name: "edit",
  summary: "Edit a file by replacing exact text hunks (old → new).",
  description:
    "Apply one or more exact-match replacements to a file. Each hunk's `old` string must match the file " +
    "content exactly (whitespace and indentation included) and occur exactly once — include enough surrounding " +
    "context to make it unique. Hunks apply in order. This is the preferred way to modify files: only the " +
    "changed hunks cross the wire, not the whole file.",
  keywords: ["edit", "modify", "change", "replace", "patch", "fix"],
  readOnly: false,
  schema: editSchema,
  async execute(input, ctx) {
    const full = resolvePath(ctx.cwd, input.path);
    const original = await readFile(full, "utf8").catch(() => null);
    if (original === null) return `File not found: ${input.path}`;

    const approved = await ctx.requestPermission("edit", `Edit ${input.path} (${input.hunks.length} hunk(s))`);
    if (!approved) return "Permission denied by user.";

    let content = original;
    const applied: string[] = [];
    for (const [i, hunk] of input.hunks.entries()) {
      const occurrences = content.split(hunk.old).length - 1;
      if (occurrences === 0) {
        return `Hunk ${i + 1} failed: old text not found in ${input.path}. No changes were written.\n` +
          `--- hunk ${i + 1} old ---\n${hunk.old.slice(0, 500)}`;
      }
      if (occurrences > 1) {
        return `Hunk ${i + 1} failed: old text occurs ${occurrences} times in ${input.path}; make it unique. ` +
          `No changes were written.`;
      }
      content = content.replace(hunk.old, hunk.new);
      applied.push(`hunk ${i + 1}: ${hunk.old.length} → ${hunk.new.length} chars`);
    }

    await writeFile(full, content);
    const delta = content.length - original.length;
    return `Edited ${input.path} (${delta >= 0 ? "+" : ""}${delta} chars)\n${applied.join("\n")}`;
  },
};
