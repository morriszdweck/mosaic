import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Task, TaskStore } from "./store.ts";
import { isStale } from "./when.ts";

/**
 * Running the standalone tasks that are due.
 *
 * This is what the OS scheduler calls once a minute. It reads the task
 * database, starts Mosaic for anything due, and exits — nothing stays resident,
 * because a background process the user has to keep alive is the problem this
 * feature exists to avoid.
 *
 * Each run is a fresh `mosaic run`, so it gets its own session with a clean
 * context. A daily task that appended to one conversation forever would grow
 * until it cost more than the work it was doing.
 */

/** A run that has not finished by now is hung; nothing useful comes of waiting. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
/** A lock older than this belonged to a process that died without releasing it. */
const LOCK_STALE_MS = 60 * 60_000;

export interface RunOutcome {
  task: Task;
  status: "ok" | "failed" | "skipped";
  detail: string;
}

function mosaicHome(): string {
  return process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
}

function root(): string {
  return process.env.MOSAIC_ROOT ?? join(import.meta.dir, "..", "..", "..");
}

/**
 * Take the run lock, or report that another run holds it.
 *
 * The scheduler fires every minute and a run can take longer than that. Without
 * this, a slow task quietly turns into a pile of concurrent Mosaics.
 */
function acquireLock(): (() => void) | null {
  const path = join(mosaicHome(), "tasks.lock");
  mkdirSync(mosaicHome(), { recursive: true });
  try {
    writeFileSync(path, String(process.pid), { flag: "wx" });
  } catch {
    try {
      if (Date.now() - statSync(path).mtimeMs < LOCK_STALE_MS) return null;
      // Stale: the holder is gone. Take it over rather than never running again.
      writeFileSync(path, String(process.pid));
    } catch {
      return null;
    }
  }
  return () => rmSync(path, { force: true });
}

export function runDue(now = Date.now()): RunOutcome[] {
  const release = acquireLock();
  if (!release) return [];

  const store = new TaskStore();
  const outcomes: RunOutcome[] = [];
  try {
    for (const task of store.dueStandalone(now)) {
      // Reschedule before running, not after: a task that throws or is killed
      // must not be retried on every tick for the rest of the day.
      store.recordFired(task.id, now);

      if (isStale(task, now)) {
        // Its next occurrence is already due — running now would deliver a
        // briefing for a time that has passed, immediately before the real one.
        outcomes.push({ task, status: "skipped", detail: "missed while the machine was off" });
        continue;
      }

      outcomes.push(runOne(store, task));
    }
  } finally {
    store.close();
    release();
  }
  return outcomes;
}

/**
 * Run one task now and record what it produced, without touching its schedule.
 *
 * Separate from `runDue` so `mosaic tasks run <id>` can try a task out without
 * consuming its next occurrence — testing tomorrow's briefing should not mean
 * tomorrow no longer gets one.
 */
export function runOne(store: TaskStore, task: Task): RunOutcome {
  const result = runTask(task);
  store.recordRun(task.id, result.status === "ok" ? "ok" : "failed", result.detail, Date.now());
  return result;
}

export async function runOneAsync(store: TaskStore, task: Task): Promise<RunOutcome> {
  const result = await runTaskAsync(task);
  store.recordRun(task.id, result.status === "ok" ? "ok" : "failed", result.detail, Date.now());
  return result;
}

function runTask(task: Task): RunOutcome {
  const timeout = Number(process.env.MOSAIC_TASK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  // A directory that has since been deleted must not take the run down with it.
  const cwd = task.directory && existsSync(task.directory) ? task.directory : homedir();

  const result = spawnSync(join(root(), "bin", "mosaic"), ["run", task.prompt], {
    cwd,
    timeout,
    encoding: "utf8",
    // No terminal: the launcher must not stop to ask anything.
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MOSAIC_HOME: mosaicHome(), MOSAIC_SCHEDULED_TASK: String(task.id) },
  });

  const output = `${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
  if (result.error) return { task, status: "failed", detail: `${result.error.message}\n${output}`.trim() };
  if (result.signal) return { task, status: "failed", detail: `Killed after ${Math.round(timeout / 60_000)}m.` };
  if (result.status !== 0) return { task, status: "failed", detail: output || `Exited with ${result.status}.` };
  return { task, status: "ok", detail: output };
}

function runTaskAsync(task: Task): Promise<RunOutcome> {
  const timeout = Number(process.env.MOSAIC_TASK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const cwd = task.directory && existsSync(task.directory) ? task.directory : homedir();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const output = () => `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
    const finish = (result: RunOutcome) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(join(root(), "bin", "mosaic"), ["run", task.prompt], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MOSAIC_HOME: mosaicHome(), MOSAIC_SCHEDULED_TASK: String(task.id) },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finish({ task, status: "failed", detail });
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      finish({ task, status: "failed", detail: `${error.message}\n${output()}`.trim() });
    });
    child.once("close", (status, signal) => {
      if (signal) {
        finish({ task, status: "failed", detail: `Killed after ${Math.round(timeout / 60_000)}m.` });
        return;
      }
      finish({
        task,
        status: status === 0 ? "ok" : "failed",
        detail: status === 0 ? output() : output() || `Exited with ${status}.`,
      });
    });
    timer = setTimeout(() => {
      child.kill();
      finish({ task, status: "failed", detail: `Killed after ${Math.round(timeout / 60_000)}m.` });
    }, timeout);
  });
}

/** Append a line per run to ~/.mosaic/logs/tasks.log, so a failure leaves a trace. */
export function logOutcomes(outcomes: RunOutcome[]): void {
  if (!outcomes.length) return;
  const path = join(mosaicHome(), "logs", "tasks.log");
  mkdirSync(join(mosaicHome(), "logs"), { recursive: true });
  const stamp = new Date().toISOString();
  const lines = outcomes.map((o) => `${stamp} [${o.task.id}] ${o.status} — ${o.task.prompt.split("\n")[0]}`);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${existing}${lines.join("\n")}\n`);
}
