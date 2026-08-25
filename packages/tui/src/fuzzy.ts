/**
 * Subsequence fuzzy matching for the palette overlays.
 *
 * Scoring favours what people actually aim at when they type three letters:
 * consecutive runs, matches right after a separator, and matches in the
 * basename of a path. Ties break toward shorter candidates so `src/app.ts`
 * outranks `src/very/long/path/app.ts` for "app".
 */

export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[];
}

const SEPARATORS = new Set(["/", "\\", "_", "-", ".", " ", ":"]);

/**
 * Score one candidate. Returns null when `needle` is not a subsequence of
 * `haystack`. An empty needle matches everything with score 0.
 */
export function fuzzyScore(haystack: string, needle: string): { score: number; positions: number[] } | null {
  if (!needle) return { score: 0, positions: [] };

  const hay = haystack.toLowerCase();
  const need = needle.toLowerCase();

  // Greedy leftmost matching picks the wrong alignment often enough to matter:
  // "config" against "src/config.ts" would take the c in "src", breaking the
  // run and losing the basename bonus. Try every possible start for the first
  // character and keep the best-scoring alignment.
  let best: { score: number; positions: number[] } | null = null;
  for (let start = hay.indexOf(need[0]!); start !== -1; start = hay.indexOf(need[0]!, start + 1)) {
    const attempt = alignFrom(haystack, hay, need, start);
    if (attempt && (!best || attempt.score > best.score)) best = attempt;
  }
  return best;
}

/** Score one alignment, with needle[0] pinned at `start`. */
function alignFrom(
  haystack: string,
  hay: string,
  need: string,
  start: number,
): { score: number; positions: number[] } | null {
  const positions: number[] = [];
  let score = 0;
  let hayIdx = start;
  let run = 0;

  for (let i = 0; i < need.length; i++) {
    const found = i === 0 ? start : hay.indexOf(need[i]!, hayIdx);
    if (found === -1) return null;

    // Consecutive characters are worth more the longer the run gets.
    run = found === hayIdx && i > 0 ? run + 1 : 0;
    score += 1 + run * 4;

    if (found === 0 || SEPARATORS.has(hay[found - 1]!)) score += 8; // start of a segment
    if (haystack[found] !== hay[found]) score += 2; // camelCase hump

    positions.push(found);
    hayIdx = found + 1;
  }

  // Prefer matches inside the basename: "app" should find src/app.ts, not
  // apparel/index.ts.
  const lastSep = Math.max(hay.lastIndexOf("/"), hay.lastIndexOf("\\"));
  if (lastSep >= 0 && positions[0]! > lastSep) score += 12;

  // Mild penalty for length so tighter candidates win ties.
  score -= Math.floor(haystack.length / 12);

  return { score, positions };
}

/** Rank `items` against `needle`, best first. */
export function fuzzyFilter<T>(items: T[], needle: string, key: (item: T) => string, limit = 50): FuzzyMatch<T>[] {
  const out: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const m = fuzzyScore(key(item), needle);
    if (m) out.push({ item, score: m.score, positions: m.positions });
  }
  out.sort((a, b) => b.score - a.score || key(a.item).length - key(b.item).length);
  return out.slice(0, limit);
}
