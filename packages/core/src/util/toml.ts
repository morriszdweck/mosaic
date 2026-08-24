/**
 * Minimal TOML subset parser — enough for ~/.mosaic/config.toml.
 * Supports: [sections], [nested.sections], key = "string" | 'literal' | number | bool | ["arrays"].
 * Comments (#) and blank lines ignored. No multi-line strings, no inline tables.
 */

type TomlValue = string | number | boolean | TomlValue[];
interface TomlTable {
  [key: string]: TomlValue | TomlTable;
}

export function parseToml(input: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;

  for (const rawLine of input.split("\n")) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const path = sectionMatch[1]!.split(".").map((s) => s.trim());
      current = root;
      for (const part of path) {
        const next = current[part];
        if (next === undefined) {
          const table: TomlTable = {};
          current[part] = table;
          current = table;
        } else if (typeof next === "object" && !Array.isArray(next)) {
          current = next as TomlTable;
        } else {
          throw new Error(`TOML: section conflicts with value: ${path.join(".")}`);
        }
      }
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) throw new Error(`TOML: cannot parse line: ${rawLine}`);
    current[kv[1]!] = parseValue(kv[2]!.trim());
  }
  return root;
}

function stripComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"' && !inSingle && line[i - 1] !== "\\") inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === "#" && !inDouble && !inSingle) return line.slice(0, i);
  }
  return line;
}

function parseValue(raw: string): TomlValue {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return splitArray(inner).map((item) => parseValue(item.trim()));
  }
  const num = Number(raw.replace(/_/g, ""));
  if (!Number.isNaN(num) && /^[-+0-9._eE]+$/.test(raw)) return num;
  throw new Error(`TOML: unsupported value: ${raw}`);
}

function splitArray(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === "[" && !inDouble && !inSingle) depth++;
    else if (c === "]" && !inDouble && !inSingle) depth--;
    else if (c === "," && depth === 0 && !inDouble && !inSingle) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/** Deep-merge b into a (b wins). Used for project-level config overrides. */
export function mergeToml(a: TomlTable, b: TomlTable): TomlTable {
  const out: TomlTable = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const existing = out[key];
    if (
      existing !== undefined &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = mergeToml(existing as TomlTable, value as TomlTable);
    } else {
      out[key] = value;
    }
  }
  return out;
}
