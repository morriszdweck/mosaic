/**
 * Tool-output truncation with head/tail elision — a core token-efficiency mechanism.
 * Long outputs keep the beginning and the end; the middle is replaced with a
 * single elision marker that reports exactly how much was removed.
 */

export interface TruncateOptions {
  /** Character cap. Output longer than this gets elided. */
  maxChars: number;
  /** Fraction of the budget given to the head (rest goes to tail). Default 0.6. */
  headRatio?: number;
}

export interface TruncatedOutput {
  text: string;
  truncated: boolean;
  originalChars: number;
}

export function truncateMiddle(input: string, options: TruncateOptions): TruncatedOutput {
  const { maxChars } = options;
  const headRatio = options.headRatio ?? 0.6;

  if (input.length <= maxChars) {
    return { text: input, truncated: false, originalChars: input.length };
  }

  const marker = (removed: number) => `\n… [${removed.toLocaleString()} chars elided] …\n`;
  // Reserve space for the marker (estimate; marker length is stable enough).
  const budget = Math.max(0, maxChars - 40);
  const headChars = Math.floor(budget * headRatio);
  const tailChars = budget - headChars;

  const head = input.slice(0, headChars);
  const tail = input.slice(input.length - tailChars);
  const removed = input.length - headChars - tailChars;

  return {
    text: head + marker(removed) + tail,
    truncated: true,
    originalChars: input.length,
  };
}

/**
 * Line-window truncation for file reads: keep a contiguous window of lines,
 * and indicate what was skipped before/after.
 */
export interface LineWindow {
  text: string;
  totalLines: number;
  startLine: number; // 1-based
  endLine: number; // 1-based, inclusive
  skippedBefore: number;
  skippedAfter: number;
}

export function windowLines(input: string, startLine: number, maxLines: number): LineWindow {
  const lines = input.split("\n");
  const totalLines = lines.length;
  const start = Math.max(1, Math.min(startLine, totalLines));
  const end = Math.min(totalLines, start + maxLines - 1);
  const slice = lines.slice(start - 1, end);
  return {
    text: slice.join("\n"),
    totalLines,
    startLine: start,
    endLine: end,
    skippedBefore: start - 1,
    skippedAfter: totalLines - end,
  };
}
