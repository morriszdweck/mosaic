import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Project file index for `@` references.
 *
 * Walked once on demand and cached: the picker has to feel instant on every
 * keystroke, and re-walking a large repo per character does not. `/` or an
 * explicit refresh drops the cache.
 */

const ALWAYS_SKIP = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".cache",
  "coverage",
  ".DS_Store",
]);

/** Files above this are almost never what an `@` reference wants. */
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES = 20_000;

let cache: { cwd: string; files: string[] } | null = null;

/** Directory prefixes from .gitignore. Deliberately simple — no full spec. */
async function ignoredPrefixes(cwd: string): Promise<string[]> {
  try {
    const raw = await readFile(join(cwd, ".gitignore"), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!") && !l.includes("*"))
      .map((l) => l.replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function indexFiles(cwd: string, force = false): Promise<string[]> {
  if (!force && cache && cache.cwd === cwd) return cache.files;

  const ignored = new Set([...ALWAYS_SKIP, ...(await ignoredPrefixes(cwd))]);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than fail the picker
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (ignored.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) continue; // symlinked dirs can loop
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(cwd, full));
      }
    }
  }

  await walk(cwd);
  out.sort((a, b) => a.split(sep).length - b.split(sep).length || a.localeCompare(b));
  cache = { cwd, files: out };
  return out;
}

export function invalidateFileIndex(): void {
  cache = null;
}

/**
 * Read a referenced file for inclusion in the prompt. Returns null for things
 * that should not be inlined (missing, a directory, too large, or binary).
 */
export async function readReference(cwd: string, relPath: string): Promise<string | null> {
  const full = join(cwd, relPath);
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const text = await readFile(full, "utf8");
    // A NUL byte in the first chunk is the usual binary tell.
    if (text.slice(0, 4096).includes("\0")) return null;
    return text;
  } catch {
    return null;
  }
}
