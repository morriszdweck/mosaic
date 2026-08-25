import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Mosaic's memory store.
 *
 * The point of this store is what it *withholds*. An agent that pastes every
 * remembered fact into each request burns context on things that do not apply
 * to the question being asked, so recall here is a ranked, budgeted search:
 * relevance-scored, capped by count, and then capped again by characters. A
 * store with a thousand memories costs the same per turn as one with ten.
 */

export type MemoryKind = "user" | "project" | "preference" | "fact";

export interface Memory {
  id: number;
  kind: MemoryKind;
  content: string;
  /** Project scope, or null for memories that apply everywhere. */
  scope: string | null;
  createdAt: number;
  /** Last time recall surfaced this, used to age out dead weight. */
  usedAt: number;
  useCount: number;
}

export interface RecallOptions {
  /** Project directory, so project-scoped memories only surface in that project. */
  scope?: string;
  /** Hard ceiling on returned memories. */
  limit?: number;
  /** Hard ceiling on total characters, applied after ranking. */
  charBudget?: number;
}

/** Words too common to discriminate between memories. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "as", "it", "its", "this",
  "that", "these", "those", "i", "you", "he", "she", "they", "we", "my", "your", "our",
  "do", "does", "did", "have", "has", "had", "can", "could", "will", "would", "should",
  "what", "when", "where", "who", "why", "how", "me", "my", "am", "if", "then", "than",
  "so", "not", "no", "yes", "there", "here", "about", "into", "over", "just", "please",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export class MemoryStore {
  private db: Database;

  constructor(path: string = defaultPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT,
        created_at INTEGER NOT NULL,
        used_at INTEGER NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope);
    `);
  }

  /**
   * Store a fact. Near-duplicates replace the original rather than
   * accumulating: repeated turns about the same preference would otherwise
   * crowd out everything else at recall time.
   */
  remember(input: { kind: MemoryKind; content: string; scope?: string | null }): Memory {
    const content = input.content.trim();
    const scope = input.scope ?? null;
    const now = Date.now();

    const existing = this.findSimilar(content, scope);
    if (existing) {
      this.db
        .prepare("UPDATE memories SET content = ?, kind = ?, used_at = ? WHERE id = ?")
        .run(content, input.kind, now, existing.id);
      return { ...existing, content, kind: input.kind, usedAt: now };
    }

    const row = this.db
      .prepare(
        `INSERT INTO memories (kind, content, scope, created_at, used_at, use_count)
         VALUES (?, ?, ?, ?, ?, 0) RETURNING *`,
      )
      .get(input.kind, content, scope, now, now) as Record<string, unknown>;
    return toMemory(row);
  }

  /** An existing memory that says substantially the same thing. */
  private findSimilar(content: string, scope: string | null): Memory | null {
    const candidates = this.all(scope);
    const words = new Set(tokenize(content));
    if (words.size === 0) return null;

    for (const candidate of candidates) {
      const other = new Set(tokenize(candidate.content));
      if (other.size === 0) continue;
      let shared = 0;
      for (const w of words) if (other.has(w)) shared++;
      // Jaccard over content words; 0.6 catches rewordings without merging
      // two genuinely different facts about the same subject.
      const union = new Set([...words, ...other]).size;
      if (shared / union >= 0.6) return candidate;
    }
    return null;
  }

  /**
   * Memories relevant to `query`, ranked and budgeted.
   *
   * Scoring is deliberately cheap — no embeddings, no model call — because it
   * runs on every turn. Overlap of content words carries most of the signal;
   * recency and prior usefulness break ties.
   */
  recall(query: string, options: RecallOptions = {}): Memory[] {
    const { scope, limit = 5, charBudget = 800 } = options;
    const queryWords = new Set(tokenize(query));
    if (queryWords.size === 0) return [];

    const now = Date.now();
    const scored: Array<{ memory: Memory; score: number }> = [];

    for (const memory of this.all(scope ?? null)) {
      const words = tokenize(memory.content);
      if (!words.length) continue;

      let overlap = 0;
      for (const w of new Set(words)) if (queryWords.has(w)) overlap++;
      if (overlap === 0) continue;

      // Normalising by length stops a long memory from ranking highly just by
      // containing many words.
      let score = overlap / Math.sqrt(new Set(words).size);
      // Facts about the user apply broadly, so they get a small standing bonus.
      if (memory.kind === "user" || memory.kind === "preference") score *= 1.25;
      // Age out gently: a year-old memory is worth ~30% less than a fresh one.
      const ageDays = (now - memory.createdAt) / 86_400_000;
      score *= 1 / (1 + ageDays / 500);
      score *= 1 + Math.min(memory.useCount, 10) / 40;

      scored.push({ memory, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const out: Memory[] = [];
    let chars = 0;
    for (const { memory } of scored) {
      if (out.length >= limit) break;
      if (chars + memory.content.length > charBudget) continue;
      out.push(memory);
      chars += memory.content.length;
    }

    if (out.length) this.markUsed(out.map((m) => m.id));
    return out;
  }

  private markUsed(ids: number[]): void {
    const now = Date.now();
    const stmt = this.db.prepare("UPDATE memories SET used_at = ?, use_count = use_count + 1 WHERE id = ?");
    for (const id of ids) stmt.run(now, id);
  }

  /** Global memories plus those scoped to this project. */
  all(scope: string | null = null): Memory[] {
    const rows = scope
      ? this.db.prepare("SELECT * FROM memories WHERE scope IS NULL OR scope = ? ORDER BY id DESC").all(scope)
      : this.db.prepare("SELECT * FROM memories ORDER BY id DESC").all();
    return (rows as Array<Record<string, unknown>>).map(toMemory);
  }

  forget(id: number): boolean {
    return this.db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}

function toMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as number,
    kind: row.kind as MemoryKind,
    content: row.content as string,
    scope: (row.scope as string | null) ?? null,
    createdAt: row.created_at as number,
    usedAt: row.used_at as number,
    useCount: row.use_count as number,
  };
}

export function defaultPath(): string {
  const home = process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
  return join(home, "memory.db");
}
