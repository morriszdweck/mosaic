import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { formatAge } from "./memory-control.tsx";
import { clip, matchesQuery, searchMosaic, type SearchResult } from "./search.ts";

export { matchesQuery } from "./search.ts";
export type { SearchResult } from "./search.ts";

export function searchOptions(
  results: readonly SearchResult[],
  now: number = Date.now(),
): Array<TuiDialogSelectOption<SearchResult>> {
  return results.map((result) => searchOption(result, now));
}

export function showSearchControlCenter(api: TuiPluginApi): void {
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Search Mosaic"
      placeholder="sessions, messages, memories, or files"
      onConfirm={(raw) => {
        const query = raw.trim();
        if (!query) {
          api.ui.toast({ variant: "error", message: "Search text is required" });
          return;
        }
        void runSearch(api, query);
      }}
    />
  ));
}

async function runSearch(api: TuiPluginApi, query: string): Promise<void> {
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert title="Search Mosaic" message={`Searching for “${clip(query, 80)}”…`} />
  ));

  try {
    const report = await searchMosaic(api, query);
    showSearchResults(api, query, report.results, report.incomplete);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert title="Search Mosaic" message={`Unable to search: ${message}`} />
    ));
  }
}

function showSearchResults(
  api: TuiPluginApi,
  query: string,
  results: readonly SearchResult[],
  incomplete: readonly string[],
): void {
  if (incomplete.length) {
    api.ui.toast({
      variant: "warning",
      message: `Partial search: ${incomplete.join(", ")} unavailable`,
    });
  }

  if (!results.length) {
    const warning = incomplete.length ? `\n\nUnavailable: ${incomplete.join(", ")}.` : "";
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert title="Search Mosaic" message={`No matches for “${clip(query, 80)}”.${warning}`} />
    ));
    return;
  }

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<SearchResult>
      title={`Search · ${results.length}`}
      placeholder={`Filter matches for ${clip(query, 50)}`}
      options={searchOptions(results)}
      onSelect={(option) => openSearchResult(api, option.value)}
    />
  ));
}

function openSearchResult(api: TuiPluginApi, result: SearchResult): void {
  switch (result.kind) {
    case "run":
    case "message":
      api.ui.dialog.clear();
      api.route.navigate("session", { sessionID: result.sessionID });
      return;
    case "memory":
      showMemoryResult(api, result);
      return;
    case "file":
    case "artifact":
      void showFileResult(api, result);
      return;
    default:
      return assertNever(result);
  }
}

function showMemoryResult(api: TuiPluginApi, result: Extract<SearchResult, { kind: "memory" }>): void {
  const scope = result.scope ? `This project · ${result.scope}` : "Everywhere";
  const message = [
    result.content,
    "",
    `${scope} · ${result.useCount} recall${result.useCount === 1 ? "" : "s"}`,
    `Saved ${formatAge(result.createdAt)}`,
    "",
    "Use /memory to manage or forget this memory.",
  ].join("\n");
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => <api.ui.DialogAlert title={`Memory #${result.id}`} message={message} />);
}

async function showFileResult(
  api: TuiPluginApi,
  result: Extract<SearchResult, { kind: "file" | "artifact" }>,
): Promise<void> {
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => <api.ui.DialogAlert title={result.path} message="Loading preview…" />);

  try {
    const response = await api.client.file.read(
      { directory: api.state.path.directory, path: result.path },
      { throwOnError: true },
    );
    const location = fileLocation(result);
    const message = [location, "", formatFileContent(response.data)].filter(Boolean).join("\n");
    api.ui.dialog.replace(() => <api.ui.DialogAlert title={result.path} message={message} />);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert title="Search Mosaic" message={`Unable to preview ${result.path}: ${message}`} />
    ));
  }
}

function searchOption(result: SearchResult, now: number): TuiDialogSelectOption<SearchResult> {
  switch (result.kind) {
    case "memory":
      return {
        title: clip(result.content, 100),
        value: result,
        category: "Memories",
        description: result.scope ? `This project · ${result.scope}` : "Everywhere",
        footer: `#${result.id} · ${formatAge(result.createdAt, now)}`,
      };
    case "run":
      return {
        title: clip(result.title, 100) || "Untitled run",
        value: result,
        category: "Runs",
        description: result.directory,
        footer: `${formatAge(result.updatedAt, now)} · ${result.sessionID}`,
      };
    case "message":
      return {
        title: clip(result.title, 100) || "Untitled run",
        value: result,
        category: "Messages",
        description: `${result.role === "user" ? "You" : "Mosaic"} · ${clip(result.snippet, 140)}`,
        footer: `${formatAge(result.createdAt, now)} · ${result.sessionID}`,
      };
    case "file":
      return {
        title: result.path,
        value: result,
        category: "Files",
        description: clip(result.snippet, 140),
        footer: result.line ? `line ${result.line}` : "file name match",
      };
    case "artifact":
      return {
        title: result.path,
        value: result,
        category: "Artifacts",
        description: `Referenced by ${clip(result.title, 100) || "Untitled run"}`,
        footer: result.sessionID,
      };
    default:
      return assertNever(result);
  }
}

function fileLocation(result: Extract<SearchResult, { kind: "file" | "artifact" }>): string {
  switch (result.kind) {
    case "file":
      return result.line ? `Line ${result.line}` : "File name match";
    case "artifact":
      return `Artifact from ${clip(result.title, 100) || "Untitled run"}`;
    default:
      return assertNever(result);
  }
}

type FilePreview = {
  readonly type: "text";
  readonly content: string;
} | {
  readonly type: "binary";
  readonly content: string;
};

function formatFileContent(content: FilePreview): string {
  switch (content.type) {
    case "text":
      return clipPreservingLines(content.content, 5_000);
    case "binary":
      return "Binary file; preview is unavailable.";
    default:
      return assertNever(content);
  }
}

function clipPreservingLines(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected search result: ${String(value)}`);
}
