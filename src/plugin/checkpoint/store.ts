import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Checkpoints: the file contents that existed before the agent changed them.
 *
 * Only files the agent is actually about to touch are captured, rather than
 * whole-directory snapshots. Snapshotting a project on every edit is slow
 * enough that people turn it off, and an undo nobody leaves enabled is worth
 * nothing. Capturing one file costs a copy.
 *
 * A file is captured once per checkpoint — the first time it is touched. That
 * first copy is the state to go back to, so later edits in the same turn must
 * not overwrite it.
 */

export interface Checkpoint {
  id: number;
  sessionID: string;
  /** Working directory the capture belongs to. */
  directory: string;
  label: string;
  createdAt: number;
  files: number;
}

export interface CapturedFile {
  path: string;
  /** Null when the file did not exist — restoring means deleting it again. */
  blob: string | null;
}

export class CheckpointStore {
  private db: Database;
  private root: string;

  constructor(home: string = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic")) {
    this.root = join(home, "checkpoints");
    mkdirSync(this.root, { recursive: true });
    this.db = new Database(join(this.root, "index.db"), { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        directory TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        checkpoint_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        blob TEXT,
        PRIMARY KEY (checkpoint_id, path)
      );
    `);
    this.migrate();
  }

  /**
   * Add columns to a table that already exists.
   *
   * `CREATE TABLE IF NOT EXISTS` is a no-op against an older database, so a new
   * column in the definition above never appears and every query naming it
   * fails at runtime. This is the release that learned that the hard way.
   */
  private migrate(): void {
    const columns = (this.db.prepare("PRAGMA table_info(checkpoints)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    if (!columns.includes("directory")) {
      this.db.exec("ALTER TABLE checkpoints ADD COLUMN directory TEXT NOT NULL DEFAULT ''");
    }
  }

  create(sessionID: string, label: string, directory = ""): Checkpoint {
    const row = this.db
      .prepare("INSERT INTO checkpoints (session_id, directory, label, created_at) VALUES (?, ?, ?, ?) RETURNING *")
      .get(sessionID, directory, label, Date.now()) as Record<string, unknown>;
    return { ...toCheckpoint(row), files: 0 };
  }

  /** The checkpoint new captures attach to: the newest in this session. */
  current(sessionID: string): Checkpoint | null {
    const row = this.db
      .prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get(sessionID) as Record<string, unknown> | null;
    return row ? this.withCount(toCheckpoint(row)) : null;
  }

  /**
   * Checkpoints for a working directory, newest first.
   *
   * Scoped by directory rather than session: `mosaic run` opens a new session
   * every invocation, so a session-scoped undo cannot reach the edit made a
   * minute ago. "Undo what was just done to my files" is a question about the
   * directory, not the conversation.
   */
  listForDirectory(directory: string, limit = 20): Checkpoint[] {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE directory = ? ORDER BY id DESC LIMIT ?")
      .all(directory, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.withCount(toCheckpoint(r)));
  }

  /**
   * Copy a file's current contents into a checkpoint.
   *
   * Returns false when the file was already captured — the point of a
   * checkpoint is the state before the *first* change, not the most recent one.
   */
  async capture(checkpointID: number, absolutePath: string, cwd: string): Promise<boolean> {
    const key = relative(cwd, resolve(absolutePath)) || resolve(absolutePath);
    const already = this.db
      .prepare("SELECT 1 FROM files WHERE checkpoint_id = ? AND path = ?")
      .get(checkpointID, key);
    if (already) return false;

    let blob: string | null = null;
    if (existsSync(absolutePath)) {
      blob = join(String(checkpointID), key.replace(/[^a-zA-Z0-9._-]/g, "_") + "." + Date.now());
      const dest = join(this.root, blob);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(absolutePath, dest);
    }
    this.db.prepare("INSERT INTO files (checkpoint_id, path, blob) VALUES (?, ?, ?)").run(checkpointID, key, blob);
    return true;
  }

  list(sessionID: string, limit = 20): Checkpoint[] {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionID, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.withCount(toCheckpoint(r)));
  }

  get(id: number): Checkpoint | null {
    const row = this.db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.withCount(toCheckpoint(row)) : null;
  }

  files(id: number): CapturedFile[] {
    return (
      this.db.prepare("SELECT path, blob FROM files WHERE checkpoint_id = ?").all(id) as Array<Record<string, unknown>>
    ).map((r) => ({ path: r.path as string, blob: (r.blob as string | null) ?? null }));
  }

  /** Put every captured file back. Returns what changed and what could not. */
  async restore(id: number, cwd: string): Promise<{ restored: string[]; removed: string[]; failed: string[] }> {
    const result = { restored: [] as string[], removed: [] as string[], failed: [] as string[] };
    for (const file of this.files(id)) {
      const target = resolve(cwd, file.path);
      try {
        if (file.blob === null) {
          // It did not exist when captured, so going back means removing it.
          await rm(target, { force: true });
          result.removed.push(file.path);
        } else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, await readFile(join(this.root, file.blob)));
          result.restored.push(file.path);
        }
      } catch {
        result.failed.push(file.path);
      }
    }
    return result;
  }

  /** Drop a checkpoint and the copies it holds. */
  async remove(id: number): Promise<boolean> {
    const existing = this.get(id);
    if (!existing) return false;
    this.db.prepare("DELETE FROM files WHERE checkpoint_id = ?").run(id);
    this.db.prepare("DELETE FROM checkpoints WHERE id = ?").run(id);
    await rm(join(this.root, String(id)), { recursive: true, force: true });
    return true;
  }

  private withCount(cp: Checkpoint): Checkpoint {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM files WHERE checkpoint_id = ?").get(cp.id) as { n: number };
    return { ...cp, files: row.n };
  }

  close(): void {
    this.db.close();
  }
}

function toCheckpoint(row: Record<string, unknown>): Checkpoint {
  return {
    id: row.id as number,
    sessionID: row.session_id as string,
    directory: (row.directory as string) ?? "",
    label: row.label as string,
    createdAt: row.created_at as number,
    files: 0,
  };
}
