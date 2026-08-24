/** Tiny unique-id helper (no deps). */
export function newId(prefix: string): string {
  const rand = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
