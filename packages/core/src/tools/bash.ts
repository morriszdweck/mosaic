import { z } from "zod";
import type { Tool, ToolContext } from "./registry.ts";
import { truncateMiddle } from "./truncate.ts";
import { newId } from "../util/ids.ts";

/**
 * bash tool: run shell commands with a timeout, plus background tasks
 * (start a server / watcher, then read or kill it later).
 */

export interface BackgroundTask {
  id: string;
  command: string;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  output: string;
  process: Bun.Subprocess | null;
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();

  list(): BackgroundTask[] {
    return [...this.tasks.values()];
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  async start(command: string, cwd: string): Promise<BackgroundTask> {
    const task: BackgroundTask = {
      id: newId("bg"),
      command,
      startedAt: Date.now(),
      exited: false,
      exitCode: null,
      output: "",
      process: null,
    };
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    task.process = proc;
    this.tasks.set(task.id, task);

    const collect = async (stream: ReadableStream<Uint8Array>) => {
      const text = await new Response(stream).text();
      task.output += text;
      // Cap retained output so a chatty process can't exhaust memory.
      if (task.output.length > 200_000) task.output = task.output.slice(-100_000);
    };
    void collect(proc.stdout);
    void collect(proc.stderr);
    void proc.exited.then((code) => {
      task.exited = true;
      task.exitCode = code;
    });
    return task;
  }

  kill(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.exited) return false;
    task.process?.kill();
    return true;
  }

  killAll(): void {
    for (const task of this.tasks.values()) {
      if (!task.exited) task.process?.kill();
    }
  }
}

export const backgroundTasks = new BackgroundTaskManager();

const bashSchema = z.object({
  command: z.string().describe("The shell command to run."),
  timeout_ms: z.number().optional().describe("Timeout in milliseconds (default from config)."),
  background: z.boolean().optional().describe("Run in the background and return a task id immediately."),
});

export const bashTool: Tool<z.infer<typeof bashSchema>> = {
  name: "bash",
  summary: "Run a shell command (foreground with timeout, or background task).",
  description:
    "Execute a shell command via sh -c in the current working directory. " +
    "Foreground commands stream nothing: you get combined stdout+stderr when they finish (or time out). " +
    "Set background=true for long-running processes (dev servers, watchers); manage them with task_output/task_kill. " +
    "Prefer dedicated tools (read/grep/glob) over cat/find/grep where possible — they are cheaper on tokens.",
  keywords: ["bash", "shell", "command", "run", "execute", "npm", "git", "build", "test", "install"],
  readOnly: false,
  schema: bashSchema,
  async execute(input, ctx) {
    if (input.background) {
      const task = await backgroundTasks.start(input.command, ctx.cwd);
      return `Started background task ${task.id}\nCommand: ${input.command}`;
    }

    const timeout = input.timeout_ms ?? (ctx.services.bashTimeoutMs as number | undefined) ?? 120_000;
    const proc = Bun.spawn(["sh", "-c", input.command], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    const onAbort = () => proc.kill();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      const capped = truncateMiddle(combined, { maxChars: ctx.outputLimit });
      const prefix = timedOut
        ? `[TIMED OUT after ${timeout}ms]\n`
        : exitCode !== 0
          ? `[exit code ${exitCode}]\n`
          : "";
      return prefix + (capped.text || "(no output)");
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  },
};

const taskOutputSchema = z.object({
  task_id: z.string().describe("Background task id returned by bash(background=true)."),
});

export const taskOutputTool: Tool<z.infer<typeof taskOutputSchema>> = {
  name: "task_output",
  summary: "Read the latest output of a background task.",
  description: "Returns the (capped) output of a background task started with bash(background=true), plus its status.",
  keywords: ["background", "task", "output", "log"],
  readOnly: true,
  schema: taskOutputSchema,
  async execute(input, ctx) {
    const task = backgroundTasks.get(input.task_id);
    if (!task) return `No such task: ${input.task_id}`;
    const capped = truncateMiddle(task.output, { maxChars: ctx.outputLimit });
    const status = task.exited ? `exited (code ${task.exitCode})` : "running";
    return `Task ${task.id} — ${status}\nCommand: ${task.command}\n---\n${capped.text || "(no output yet)"}`;
  },
};

const taskKillSchema = z.object({
  task_id: z.string().describe("Background task id to kill."),
});

export const taskKillTool: Tool<z.infer<typeof taskKillSchema>> = {
  name: "task_kill",
  summary: "Kill a running background task.",
  description: "Sends SIGKILL to a background task started with bash(background=true).",
  keywords: ["background", "task", "kill", "stop"],
  readOnly: false,
  schema: taskKillSchema,
  async execute(input) {
    return backgroundTasks.kill(input.task_id) ? `Killed ${input.task_id}` : `No running task: ${input.task_id}`;
  },
};
