import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Scheduled tasks.
 *
 * A task is a prompt the agent asked to be given back to itself later, in the
 * session it was scheduled from. When it fires it arrives the same way a typed
 * message would, so the agent already has the conversation it was planning
 * against — no re-explaining what the task was for.
 *
 * That binding to a session is also the limit: a task can only fire while
 * Mosaic is running. Anything that must survive a restart belongs in cron
 * calling `mosaic run`.
 */

export interface Task {
  id: number;
  sessionID: string;
  /** A heartbeat is a standing check rather than a one-off reminder. */
  heartbeat: boolean;
  prompt: string;
  /** Epoch millis of the next fire. */
  dueAt: number;
  /** Seconds between repeats, or null for one-shot. */
  repeat: number | null;
  /** Human text the user gave, kept for listings. */
  when: string;
  fired: number;
  createdAt: number;
  /** Set once a one-shot has fired, so it is not re-run. */
  done: boolean;
}

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
        done INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due_at, done);
    `);
  }

  add(input: {
    sessionID: string;
    prompt: string;
    dueAt: number;
    repeat?: number | null;
    when: string;
    heartbeat?: boolean;
  }): Task {
    if (!input.prompt.trim()) throw new Error("A task needs a prompt.");
    if (input.repeat != null && input.repeat < 60) throw new Error("Repeat must be at least 60 seconds.");
    const row = this.db
      .prepare(
        `INSERT INTO tasks (session_id, prompt, due_at, repeat, when_text, created_at, heartbeat)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.sessionID,
        input.prompt.trim(),
        input.dueAt,
        input.repeat ?? null,
        input.when,
        Date.now(),
        input.heartbeat ? 1 : 0,
      ) as Record<string, unknown>;
    return toTask(row);
  }

  /** Pending tasks, optionally for one session. */
  list(sessionID?: string): Task[] {
    const rows = sessionID
      ? this.db.prepare("SELECT * FROM tasks WHERE done = 0 AND session_id = ? ORDER BY due_at").all(sessionID)
      : this.db.prepare("SELECT * FROM tasks WHERE done = 0 ORDER BY due_at").all();
    return (rows as Array<Record<string, unknown>>).map(toTask);
  }

  due(sessionID: string, now = Date.now()): Task[] {
    return this.list(sessionID).filter((t) => t.dueAt <= now);
  }

  /**
   * Mark a task as having fired: reschedule a repeat, retire a one-shot.
   *
   * Repeats advance from *now* rather than from the previous due time, so a
   * Mosaic that was closed for a week does not come back and fire the same
   * task a hundred times catching up.
   */
  recordFired(id: number, now = Date.now()): void {
    const task = this.get(id);
    if (!task) return;
    if (task.repeat === null) {
      this.db.prepare("UPDATE tasks SET fired = fired + 1, done = 1 WHERE id = ?").run(id);
      return;
    }
    this.db.prepare("UPDATE tasks SET fired = fired + 1, due_at = ? WHERE id = ?").run(now + task.repeat * 1000, id);
  }

  get(id: number): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? toTask(row) : null;
  }

  /** The running heartbeat for a session, if any. Only one at a time. */
  heartbeatFor(sessionID: string): Task | null {
    return this.list(sessionID).find((t) => t.heartbeat) ?? null;
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
  return {
    id: row.id as number,
    sessionID: row.session_id as string,
    prompt: row.prompt as string,
    dueAt: row.due_at as number,
    repeat: (row.repeat as number | null) ?? null,
    when: row.when_text as string,
    heartbeat: (row.heartbeat as number) === 1,
    fired: row.fired as number,
    createdAt: row.created_at as number,
    done: (row.done as number) === 1,
  };
}

export function defaultPath(): string {
  const home = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
  return join(home, "tasks.db");
}

export interface ParsedWhen {
  dueAt: number;
  repeat: number | null;
}

/**
 * Parse the phrasings people actually use for "when".
 *
 * Kept small and predictable on purpose: a scheduler that guesses is worse
 * than one that says it did not understand. Anything richer should be an
 * explicit delay the agent computes itself.
 */
export function parseWhen(text: string, now = Date.now()): ParsedWhen {
  const raw = text.trim().toLowerCase();

  const every = /^every\s+(\d+)\s*(s|sec|secs|seconds?|m|min|mins?|minutes?|h|hr|hrs?|hours?|d|days?)$/.exec(raw);
  if (every) {
    const seconds = toSeconds(Number(every[1]), every[2]!);
    return { dueAt: now + seconds * 1000, repeat: seconds };
  }

  const relative = /^(?:in\s+)?(\d+)\s*(s|sec|secs|seconds?|m|min|mins?|minutes?|h|hr|hrs?|hours?|d|days?)$/.exec(raw);
  if (relative) {
    return { dueAt: now + toSeconds(Number(relative[1]), relative[2]!) * 1000, repeat: null };
  }

  // An absolute time today, rolling to tomorrow if it has already passed.
  const at = /^(?:at\s+)?(\d{1,2}):(\d{2})$/.exec(raw);
  if (at) {
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(Number(at[1]), Number(at[2]));
    let due = target.getTime();
    if (due <= now) due += 86_400_000;
    return { dueAt: due, repeat: null };
  }

  throw new Error(`Cannot read "${text}". Use "in 10m", "every 2h", or "at 14:30".`);
}

function toSeconds(n: number, unit: string): number {
  if (unit.startsWith("s")) return n;
  if (unit.startsWith("m")) return n * 60;
  if (unit.startsWith("h")) return n * 3600;
  return n * 86400;
}

export function describeWhen(task: Task, now = Date.now()): string {
  const secs = Math.max(0, Math.round((task.dueAt - now) / 1000));
  const rel = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.round(secs / 60)}m` : `${Math.round(secs / 3600)}h`;
  return task.repeat ? `in ${rel}, then every ${Math.round(task.repeat / 60)}m` : `in ${rel}`;
}
