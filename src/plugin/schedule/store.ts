import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { nextOccurrence } from "./when.ts";

/**
 * Scheduled tasks.
 *
 * Two kinds, and the difference is what they are bound to:
 *
 * - A **session** task is a prompt the agent asked to be given back to itself
 *   later, in the conversation it was scheduled from. It arrives the same way a
 *   typed message would, so the agent already has the context it was planning
 *   against. It can only fire while that conversation is open.
 *
 * - A **standalone** task is bound to nothing. It lives in this database, an OS
 *   scheduler wakes Mosaic for it, and each run starts a fresh session in the
 *   directory the task was created in. It survives quitting Mosaic, logging
 *   out, and rebooting — which is the whole point of it.
 *
 * Standalone is what "every weekday at 08:00" has to mean. A daily briefing
 * that only happens when you already have the app open is not a daily briefing.
 */

export type Scope = "session" | "standalone";

/**
 * How a task repeats.
 *
 * Intervals cannot express "every day at 09:00": 86400 seconds from the last
 * run drifts as soon as one run is late, and drifts an hour twice a year on
 * DST. Calendar recurrences are resolved against the local clock each time
 * instead, so 09:00 stays 09:00.
 */
export type Recurrence =
  | { kind: "interval"; seconds: number }
  /** `minute` is minutes since local midnight. */
  | { kind: "daily"; minute: number }
  /** `days` are local weekday numbers, 0 = Sunday. */
  | { kind: "weekly"; minute: number; days: number[] };

export interface Task {
  id: number;
  /** Empty for standalone tasks — they belong to no conversation. */
  sessionID: string;
  scope: Scope;
  /** Working directory a standalone run happens in. */
  directory: string;
  /** A heartbeat is a standing check rather than a one-off reminder. */
  heartbeat: boolean;
  prompt: string;
  /** Epoch millis of the next fire. */
  dueAt: number;
  /** Seconds between repeats, or null for one-shot. Interval recurrences only. */
  repeat: number | null;
  /** Calendar recurrence, when the repeat is not a fixed interval. */
  recurrence: Recurrence | null;
  /** Human text the user gave, kept for listings. */
  when: string;
  fired: number;
  createdAt: number;
  /** Set once a one-shot has fired, so it is not re-run. */
  done: boolean;
  paused: boolean;
  lastRunAt: number | null;
  lastStatus: "ok" | "failed" | null;
  /** Tail of the last run's output, so `mosaic tasks` can show what happened. */
  lastOutput: string | null;
}

/** Output kept per run. Enough to see what happened, not a transcript store. */
const OUTPUT_LIMIT = 4000;

export class TaskStore {
  private db: Database;

  constructor(path: string = defaultPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        repeat INTEGER,
        when_text TEXT NOT NULL,
        heartbeat INTEGER NOT NULL DEFAULT 0,
        fired INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT 'session',
        directory TEXT NOT NULL DEFAULT '',
        recurrence TEXT,
        last_run_at INTEGER,
        last_status TEXT,
        last_output TEXT,
        paused INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due_at, done);
    `);
    this.migrate();
  }

  /**
   * Add columns to a table that already exists.
   *
   * `CREATE TABLE IF NOT EXISTS` is a no-op against an older database, so a new
   * column in the definition above never appears and every query naming it
   * fails at runtime. Anyone upgrading has a tasks.db from before standalone
   * tasks existed.
   */
  private migrate(): void {
    const columns = (this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((c) => c.name);
    const add = (name: string, definition: string) => {
      if (!columns.includes(name)) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
    };
    add("scope", "TEXT NOT NULL DEFAULT 'session'");
    add("directory", "TEXT NOT NULL DEFAULT ''");
    add("recurrence", "TEXT");
    add("heartbeat", "INTEGER NOT NULL DEFAULT 0");
    add("last_run_at", "INTEGER");
    add("last_status", "TEXT");
    add("last_output", "TEXT");
    add("paused", "INTEGER NOT NULL DEFAULT 0");
  }

  add(input: {
    sessionID?: string;
    scope?: Scope;
    directory?: string;
    prompt: string;
    dueAt: number;
    repeat?: number | null;
    recurrence?: Recurrence | null;
    when: string;
    heartbeat?: boolean;
  }): Task {
    if (!input.prompt.trim()) throw new Error("A task needs a prompt.");
    if (input.repeat != null && input.repeat < 60) throw new Error("Repeat must be at least 60 seconds.");
    const scope = input.scope ?? "session";
    if (scope === "session" && !input.sessionID) throw new Error("A session task needs a session.");
    const row = this.db
      .prepare(
        `INSERT INTO tasks (session_id, prompt, due_at, repeat, when_text, created_at, heartbeat, scope, directory, recurrence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.sessionID ?? "",
        input.prompt.trim(),
        input.dueAt,
        input.repeat ?? null,
        input.when,
        Date.now(),
        input.heartbeat ? 1 : 0,
        scope,
        input.directory ?? "",
        input.recurrence ? JSON.stringify(input.recurrence) : null,
      ) as Record<string, unknown>;
    return toTask(row);
  }

  /** Pending session tasks, optionally for one session. Paused tasks remain visible. */
  list(sessionID?: string): Task[] {
    const rows = sessionID
      ? this.db
          .prepare("SELECT * FROM tasks WHERE done = 0 AND scope = 'session' AND session_id = ? ORDER BY due_at")
          .all(sessionID)
      : this.db.prepare("SELECT * FROM tasks WHERE done = 0 AND scope = 'session' ORDER BY due_at").all();
    return (rows as Array<Record<string, unknown>>).map(toTask);
  }

  /** Pending standalone tasks, newest schedule first. Paused tasks remain visible. */
  listStandalone(directory?: string): Task[] {
    const rows = directory
      ? this.db
          .prepare("SELECT * FROM tasks WHERE done = 0 AND scope = 'standalone' AND directory = ? ORDER BY due_at")
          .all(directory)
      : this.db.prepare("SELECT * FROM tasks WHERE done = 0 AND scope = 'standalone' ORDER BY due_at").all();
    return (rows as Array<Record<string, unknown>>).map(toTask);
  }

  due(sessionID: string, now = Date.now()): Task[] {
    return this.list(sessionID).filter((t) => !t.paused && t.dueAt <= now);
  }

  dueStandalone(now = Date.now()): Task[] {
    return this.listStandalone().filter((t) => !t.paused && t.dueAt <= now);
  }

  /**
   * Mark a task as having fired: reschedule a repeat, retire a one-shot.
   *
   * A repeating task is advanced to its next occurrence *after now*, never to a
   * time already in the past. A Mosaic that was closed for a week therefore
   * comes back to one due run, not to a hundred queued ones.
   */
  recordFired(id: number, now = Date.now()): void {
    const task = this.get(id);
    if (!task) return;
    const next = nextOccurrence(task, now);
    if (next === null) {
      this.db.prepare("UPDATE tasks SET fired = fired + 1, done = 1 WHERE id = ?").run(id);
      return;
    }
    this.db.prepare("UPDATE tasks SET fired = fired + 1, due_at = ? WHERE id = ?").run(next, id);
  }

  /** Store the outcome of a task run so a listing can show what happened. */
  recordRun(id: number, status: "ok" | "failed", output: string, now = Date.now()): void {
    const tail = output.length > OUTPUT_LIMIT ? output.slice(-OUTPUT_LIMIT) : output;
    this.db.prepare("UPDATE tasks SET last_run_at = ?, last_status = ?, last_output = ? WHERE id = ?").run(
      now,
      status,
      tail,
      id,
    );
  }

  /** Pause or resume a pending task without changing its next occurrence. */
  setPaused(id: number, paused: boolean): boolean {
    return (
      this.db
        .prepare("UPDATE tasks SET paused = ? WHERE id = ? AND done = 0")
        .run(paused ? 1 : 0, id).changes > 0
    );
  }

  /** Update a pending task's prompt and schedule, preserving its run history. */
  update(input: {
    id: number;
    prompt: string;
    dueAt: number;
    repeat: number | null;
    recurrence: Recurrence | null;
    when: string;
  }): boolean {
    if (!input.prompt.trim()) throw new Error("A task needs a prompt.");
    if (!input.when.trim()) throw new Error("A task needs a schedule.");
    if (input.repeat != null && input.repeat < 60) throw new Error("Repeat must be at least 60 seconds.");
    return (
      this.db
        .prepare(
          `UPDATE tasks
           SET prompt = ?, due_at = ?, repeat = ?, recurrence = ?, when_text = ?
           WHERE id = ? AND done = 0`,
        )
        .run(
          input.prompt.trim(),
          input.dueAt,
          input.repeat,
          input.recurrence ? JSON.stringify(input.recurrence) : null,
          input.when.trim(),
          input.id,
        ).changes > 0
    );
  }

  get(id: number): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? toTask(row) : null;
  }

  /** The running heartbeat for a session, if any. Only one at a time. */
  heartbeatFor(sessionID: string): Task | null {
    return this.list(sessionID).find((t) => t.heartbeat && !t.paused) ?? null;
  }

  /** Stop every heartbeat in a session. Returns how many were stopped. */
  stopHeartbeats(sessionID: string): number {
    let stopped = 0;
    for (const task of this.list(sessionID)) {
      if (task.heartbeat && this.cancel(task.id)) stopped++;
    }
    return stopped;
  }

  cancel(id: number): boolean {
    return this.db.prepare("UPDATE tasks SET done = 1 WHERE id = ? AND done = 0").run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

function toTask(row: Record<string, unknown>): Task {
  const recurrence = row.recurrence as string | null;
  return {
    id: row.id as number,
    sessionID: row.session_id as string,
    scope: ((row.scope as string) ?? "session") as Scope,
    directory: (row.directory as string) ?? "",
    prompt: row.prompt as string,
    dueAt: row.due_at as number,
    repeat: (row.repeat as number | null) ?? null,
    recurrence: recurrence ? (JSON.parse(recurrence) as Recurrence) : null,
    when: row.when_text as string,
    heartbeat: (row.heartbeat as number) === 1,
    fired: row.fired as number,
    createdAt: row.created_at as number,
    done: (row.done as number) === 1,
    lastRunAt: (row.last_run_at as number | null) ?? null,
    lastStatus: (row.last_status as "ok" | "failed" | null) ?? null,
    lastOutput: (row.last_output as string | null) ?? null,
    paused: (row.paused as number) === 1,
  };
}

export function defaultPath(): string {
  const home = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
  return join(home, "tasks.db");
}

// Re-exported so callers have one import for a task and the language that
// describes it.
export { describeWhen, isStale, nextOccurrence, parseWhen } from "./when.ts";
export type { ParsedWhen } from "./when.ts";
