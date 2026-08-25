import { Database } from "bun:sqlite";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dbPath, ensureDir, fileExists, mosaicHome, sessionsDir } from "../util/paths.ts";
import { newId } from "../util/ids.ts";
import type { Message, Usage } from "../types.ts";

/**
 * Sessions: metadata in SQLite, full transcript as JSONL (one line per event).
 * Supports --continue (latest), --resume <id>, fork, and rewind.
 */

export interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  /** Total tokens across the session. */
  inputTokens: number;
  outputTokens: number;
  /** Fork lineage: the session this one was forked from, if any. */
  parentId: string | null;
}

interface TranscriptEvent {
  type: "message";
  at: number;
  message: Message;
}

export class SessionStore {
  private db: Database | null = null;
  private readonly path: string;
  private readonly transcriptsDir: string;

  constructor(path?: string, transcriptsDir?: string) {
    this.path = path ?? dbPath();
    this.transcriptsDir = transcriptsDir ?? sessionsDir();
  }

  private open(): Database {
    if (this.db) return this.db;
    this.db = new Database(this.path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT
      )
    `);
    return this.db;
  }

  static async create(path?: string, transcriptsDir?: string): Promise<SessionStore> {
    if (!path) await ensureDir(mosaicHome());
    await ensureDir(transcriptsDir ?? sessionsDir());
    return new SessionStore(path, transcriptsDir);
  }

  private transcriptPath(id: string): string {
    return join(this.transcriptsDir, `${id}.jsonl`);
  }

  async createSession(input: { title?: string; cwd: string; model: string; parentId?: string }): Promise<SessionMeta> {
    const now = Date.now();
    const meta: SessionMeta = {
      id: newId("ses"),
      title: input.title ?? "New session",
      cwd: input.cwd,
      model: input.model,
      createdAt: now,
      updatedAt: now,
      inputTokens: 0,
      outputTokens: 0,
      parentId: input.parentId ?? null,
    };
    this.open()
      .prepare(
        `INSERT INTO sessions (id, title, cwd, model, created_at, updated_at, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(meta.id, meta.title, meta.cwd, meta.model, meta.createdAt, meta.updatedAt, meta.parentId);
    await writeFile(this.transcriptPath(meta.id), "");
    return meta;
  }

  async appendMessage(id: string, message: Message): Promise<void> {
    const event: TranscriptEvent = { type: "message", at: Date.now(), message };
    await appendFile(this.transcriptPath(id), JSON.stringify(event) + "\n");
    this.open().prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
  }

  /**
   * Replace a session's transcript with the current in-memory conversation.
   *
   * Agent runtimes retain every message, so appending that array at the end of
   * each turn duplicates the whole history. Replacing also faithfully records
   * history after context compaction, which can rewrite older messages.
   */
  async replaceTranscript(id: string, messages: readonly Message[]): Promise<void> {
    const now = Date.now();
    const transcript = messages
      .map((message) => JSON.stringify({ type: "message", at: now, message }) + "\n")
      .join("");
    await writeFile(this.transcriptPath(id), transcript);
    this.open().prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, id);
  }

  async addUsage(id: string, usage: Usage): Promise<void> {
    this.open()
      .prepare(`UPDATE sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?`)
      .run(usage.inputTokens, usage.outputTokens, id);
  }

  async setTitle(id: string, title: string): Promise<void> {
    this.open().prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(title, Date.now(), id);
  }

  async readTranscript(id: string): Promise<Message[]> {
    if (!(await fileExists(this.transcriptPath(id)))) return [];
    const raw = await readFile(this.transcriptPath(id), "utf8");
    const messages: Message[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as TranscriptEvent;
        if (event.type === "message") messages.push(event.message);
      } catch {
        // tolerate a torn final line after a crash
      }
    }
    return messages;
  }

  get(id: string): SessionMeta | null {
    const row = this.open().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Record<string, unknown> | null;
    return row ? rowToMeta(row) : null;
  }

  latest(): SessionMeta | null {
    const row = this.open().prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1`).get() as
      | Record<string, unknown>
      | null;
    return row ? rowToMeta(row) : null;
  }

  list(limit = 50): SessionMeta[] {
    const rows = this.open()
      .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToMeta);
  }

  /** Fork: copy metadata and transcript so the new session diverges cleanly. */
  async fork(id: string): Promise<SessionMeta | null> {
    const source = this.get(id);
    if (!source) return null;
    const fork = await this.createSession({
      title: `${source.title} (fork)`,
      cwd: source.cwd,
      model: source.model,
      parentId: id,
    });
    const transcript = await this.readTranscript(id);
    for (const message of transcript) await this.appendMessage(fork.id, message);
    return fork;
  }

  /** Rewind: drop the last N messages from the transcript. */
  async rewind(id: string, messagesToDrop: number): Promise<number> {
    const transcript = await this.readTranscript(id);
    const keep = Math.max(0, transcript.length - messagesToDrop);
    const kept = transcript.slice(0, keep);
    await writeFile(this.transcriptPath(id), "");
    for (const message of kept) await this.appendMessage(id, message);
    return transcript.length - kept.length;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

function rowToMeta(row: Record<string, unknown>): SessionMeta {
  return {
    id: String(row.id),
    title: String(row.title),
    cwd: String(row.cwd),
    model: String(row.model),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    parentId: row.parent_id === null ? null : String(row.parent_id),
  };
}
