import { Database } from "bun:sqlite";
import { dbPath, ensureDir, mosaicHome } from "../util/paths.ts";
import { newId } from "../util/ids.ts";

/**
 * Persistent memory store (SQLite).
 * Facts/preferences are extracted post-session and recalled by keyword overlap
 * (embedding-lite: normalized token-set scoring). Memories are never stuffed
 * wholesale into context — only the top-K relevant ones.
 */

export interface Memory {
  id: string;
  kind: "fact" | "preference" | "decision" | "note";
  content: string;
  /** Space-separated keywords for retrieval (lowercase). */
  keywords: string;
  createdAt: number;
  lastRecalledAt: number | null;
  recallCount: number;
  /** Project this memory belongs to, or null for global. */
  project: string | null;
}

export class MemoryStore {
  private db: Database | null = null;
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? dbPath();
  }

  private open(): Database {
    if (this.db) return this.db;
    this.db = new Database(this.path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        keywords TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_recalled_at INTEGER,
        recall_count INTEGER NOT NULL DEFAULT 0,
        project TEXT
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project)");
    return this.db;
  }

  static async create(path?: string): Promise<MemoryStore> {
    if (!path) await ensureDir(mosaicHome());
    return new MemoryStore(path);
  }

  save(input: {
    kind: Memory["kind"];
    content: string;
    keywords?: string[];
    project?: string | null;
  }): Memory {
    const keywords = (input.keywords ?? extractKeywords(input.content)).join(" ");
    const memory: Memory = {
      id: newId("mem"),
      kind: input.kind,
      content: input.content,
      keywords,
      createdAt: Date.now(),
      lastRecalledAt: null,
      recallCount: 0,
      project: input.project ?? null,
    };
    this.open()
      .prepare(
        `INSERT INTO memories (id, kind, content, keywords, created_at, project)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(memory.id, memory.kind, memory.content, memory.keywords, memory.createdAt, memory.project);
    return memory;
  }

  /**
   * Recall by keyword overlap. Scores: |query ∩ memory keywords| / sqrt(|memory keywords|),
   * with a small boost for frequently recalled memories. Returns top-K.
   */
  recall(query: string, limit = 5, project?: string | null): Memory[] {
    const queryTokens = new Set(tokenize(query));
    if (!queryTokens.size) return [];

    const rows = this.open()
      .prepare(
        project
          ? `SELECT * FROM memories WHERE project IS NULL OR project = ?`
          : `SELECT * FROM memories`,
      )
      .all(...(project ? [project] : [])) as Array<Record<string, unknown>>;

    const scored = rows
      .map((row) => {
        const memory = rowToMemory(row);
        const memTokens = new Set(memory.keywords.split(" ").filter(Boolean));
        let overlap = 0;
        for (const t of queryTokens) if (memTokens.has(t)) overlap++;
        const score = overlap === 0 ? 0 : overlap / Math.sqrt(Math.max(memTokens.size, 1)) + Math.min(memory.recallCount, 10) * 0.01;
        return { memory, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const stmt = this.open().prepare(
      `UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?`,
    );
    const now = Date.now();
    for (const { memory } of scored) stmt.run(now, memory.id);

    return scored.map((s) => s.memory);
  }

  list(project?: string | null, limit = 100): Memory[] {
    const rows = (
      project
        ? this.open().prepare(`SELECT * FROM memories WHERE project = ? OR project IS NULL ORDER BY created_at DESC LIMIT ?`).all(project, limit)
        : this.open().prepare(`SELECT * FROM memories ORDER BY created_at DESC LIMIT ?`).all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map(rowToMemory);
  }

  forget(id: string): boolean {
    const result = this.open().prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  count(): number {
    const row = this.open().prepare(`SELECT COUNT(*) as n FROM memories`).get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: String(row.id),
    kind: row.kind as Memory["kind"],
    content: String(row.content),
    keywords: String(row.keywords),
    createdAt: Number(row.created_at),
    lastRecalledAt: row.last_recalled_at === null ? null : Number(row.last_recalled_at),
    recallCount: Number(row.recall_count),
    project: row.project === null ? null : String(row.project),
  };
}

const STOP_WORDS = new Set(
  "the a an and or but if then else when at by for with about into through during of to in is are was were be been being do does did have has had i you he she it we they this that these those as on from".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function extractKeywords(content: string, max = 12): string[] {
  const freq = new Map<string, number>();
  for (const token of tokenize(content)) freq.set(token, (freq.get(token) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([token]) => token);
}
