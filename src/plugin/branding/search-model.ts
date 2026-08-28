import type { FilePart, Part } from "@opencode-ai/sdk/v2";

export type SearchResult =
  | {
      readonly kind: "memory";
      readonly id: number;
      readonly content: string;
      readonly scope: string | null;
      readonly createdAt: number;
      readonly useCount: number;
    }
  | {
      readonly kind: "run";
      readonly sessionID: string;
      readonly title: string;
      readonly directory: string;
      readonly updatedAt: number;
    }
  | {
      readonly kind: "message";
      readonly sessionID: string;
      readonly title: string;
      readonly role: "user" | "assistant";
      readonly snippet: string;
      readonly createdAt: number;
    }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly line: number;
      readonly snippet: string;
    }
  | {
      readonly kind: "artifact";
      readonly path: string;
      readonly sessionID: string;
      readonly title: string;
    };

export type SearchSource = "memories" | "sessions" | "messages" | "file contents" | "file names";

export type SearchReport = {
  readonly results: readonly SearchResult[];
  readonly incomplete: readonly SearchSource[];
};

export function matchesQuery(text: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return false;
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function searchablePartText(part: Part): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return part.text;
    case "subtask":
      return `${part.prompt} ${part.description}`;
    case "file":
      return filePartText(part);
    case "tool":
      return toolPartText(part);
    case "step-start":
      return "";
    case "step-finish":
      return part.reason;
    case "snapshot":
      return part.snapshot;
    case "patch":
      return part.files.join(" ");
    case "agent":
      return part.name;
    case "retry":
    case "compaction":
      return "";
    default:
      return assertNever(part);
  }
}

function filePartText(part: FilePart): string {
  return filePartPaths(part).join(" ");
}

function filePartPaths(part: FilePart): readonly string[] {
  if (!part.source) return part.filename ? [part.filename] : [];
  switch (part.source.type) {
    case "file":
    case "symbol":
      return [part.source.path];
    case "resource":
      return part.filename ? [part.filename] : [];
    default:
      return assertNever(part.source);
  }
}

function toolPartText(part: Extract<Part, { type: "tool" }>): string {
  switch (part.state.status) {
    case "pending":
      return part.tool;
    case "running":
      return `${part.tool} ${part.state.title ?? ""}`;
    case "completed":
      return `${part.tool} ${part.state.output}`;
    case "error":
      return `${part.tool} ${part.state.error}`;
    default:
      return assertNever(part.state);
  }
}

export function artifactPaths(part: Part): readonly string[] {
  switch (part.type) {
    case "file":
      return filePartPaths(part);
    case "patch":
      return part.files;
    case "tool":
      return part.state.status === "completed" ? (part.state.attachments?.flatMap(artifactPaths) ?? []) : [];
    case "text":
    case "reasoning":
    case "subtask":
    case "step-start":
    case "step-finish":
    case "snapshot":
    case "agent":
    case "retry":
    case "compaction":
      return [];
    default:
      return assertNever(part);
  }
}

export function dedupeResults(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = resultKey(result);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resultKey(result: SearchResult): string {
  switch (result.kind) {
    case "memory":
      return `memory:${result.id}`;
    case "run":
      return `run:${result.sessionID}`;
    case "message":
      return `message:${result.sessionID}:${result.createdAt}:${result.snippet}`;
    case "file":
      return `file:${result.path}:${result.line}`;
    case "artifact":
      return `artifact:${result.sessionID}:${result.path}`;
    default:
      return assertNever(result);
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function clip(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected search value: ${String(value)}`);
}
