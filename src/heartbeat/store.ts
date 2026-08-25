import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Heartbeat jobs: recurring wake-ups that start a *fresh* agent run.
 *
 * The freshness is the point. A long-lived agent that stays resident
 * accumulates history and its per-tick cost climbs until it compacts or falls
 * over. A heartbeat instead re-enters with only the job's prompt and whatever
 * the agent chooses to look up, so tick 500 costs what tick 1 did.
 */

export interface Job {
  id: number;
  name: string;
  /** Prompt handed to the agent on each tick. */
  prompt: string;
  /** Seconds between runs. */
  interval: number;
  /** Which agent runs it. */
  agent: string;
  /** Working directory for the run. */
  cwd: string;
  enabled: boolean;
  /** Stop after this many runs. null = forever. A runaway job is worse than a stalled one. */
  maxRuns: number | null;
  runs: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
}

export interface NewJob {
  name: string;
  prompt: string;
  interval: number;
  agent?: string;
  cwd?: string;
  maxRuns?: number | null;
}

export class JobStore {
  private db: Database;

  constructor(path: string = defaultPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        prompt TEXT NOT NULL,
        interval INTEGER NOT NULL,
        agent TEXT NOT NULL DEFAULT 'mosaic',
        cwd TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        max_runs INTEGER,
        runs INTEGER NOT NULL DEFAULT 0,
        last_run_at INTEGER,
        last_status TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  add(input: NewJob): Job {
    if (input.interval < 60) throw new Error("Interval must be at least 60 seconds.");
    if (!input.prompt.trim()) throw new Error("A job needs a prompt.");
    const row = this.db
      .prepare(
        `INSERT INTO jobs (name, prompt, interval, agent, cwd, max_runs, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.name,
        input.prompt.trim(),
        input.interval,
        input.agent ?? "mosaic",
        input.cwd ?? process.cwd(),
        input.maxRuns ?? null,
        Date.now(),
      ) as Record<string, unknown>;
    return toJob(row);
  }

  list(): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY id").all() as Array<Record<string, unknown>>).map(toJob);
  }

  get(nameOrId: string): Job | null {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE name = ? OR id = ?")
      .get(nameOrId, Number(nameOrId) || -1) as Record<string, unknown> | null;
    return row ? toJob(row) : null;
  }

  remove(nameOrId: string): boolean {
    return this.db.prepare("DELETE FROM jobs WHERE name = ? OR id = ?").run(nameOrId, Number(nameOrId) || -1).changes > 0;
  }

  setEnabled(nameOrId: string, enabled: boolean): boolean {
    return (
      this.db
        .prepare("UPDATE jobs SET enabled = ? WHERE name = ? OR id = ?")
        .run(enabled ? 1 : 0, nameOrId, Number(nameOrId) || -1).changes > 0
    );
  }

  recordRun(id: number, status: string): void {
    this.db
      .prepare("UPDATE jobs SET runs = runs + 1, last_run_at = ?, last_status = ? WHERE id = ?")
      .run(Date.now(), status.slice(0, 200), id);
  }

  /**
   * Jobs whose next run is due.
   *
   * A job that has never run is due immediately — the alternative is telling
   * someone their 12-hour job will start in 12 hours.
   */
  due(now = Date.now()): Job[] {
    return this.list().filter((job) => {
      if (!job.enabled) return false;
      if (job.maxRuns !== null && job.runs >= job.maxRuns) return false;
      if (job.lastRunAt === null) return true;
      return now - job.lastRunAt >= job.interval * 1000;
    });
  }

  close(): void {
    this.db.close();
  }
}

function toJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as number,
    name: row.name as string,
    prompt: row.prompt as string,
    interval: row.interval as number,
    agent: row.agent as string,
    cwd: row.cwd as string,
    enabled: (row.enabled as number) === 1,
    maxRuns: (row.max_runs as number | null) ?? null,
    runs: row.runs as number,
    lastRunAt: (row.last_run_at as number | null) ?? null,
    lastStatus: (row.last_status as string | null) ?? null,
    createdAt: row.created_at as number,
  };
}

export function defaultPath(): string {
  const home = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
  return join(home, "heartbeat.db");
}

/** "30m", "2h", "90s", "1d" → seconds. Plain numbers are seconds. */
export function parseInterval(text: string): number {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(text.trim());
  if (!match) throw new Error(`Cannot read interval "${text}". Use e.g. 90s, 30m, 2h, 1d.`);
  const n = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const scale = { s: 1, m: 60, h: 3600, d: 86400 }[unit]!;
  return n * scale;
}

export function formatInterval(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
