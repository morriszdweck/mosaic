import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { MemoryStore } from "../memory/store.ts";
import {
  artifactPaths,
  clip,
  dedupeResults,
  escapeRegExp,
  matchesQuery,
  searchablePartText,
  type SearchReport,
  type SearchResult,
  type SearchSource,
} from "./search-model.ts";

export type { SearchReport, SearchResult, SearchSource } from "./search-model.ts";
export { clip, matchesQuery } from "./search-model.ts";

type SearchBatch = {
  readonly results: readonly SearchResult[];
  readonly incomplete: readonly SearchSource[];
};

type FileTextMatch = {
  readonly path: { readonly text: string };
  readonly lines: { readonly text: string };
  readonly line_number: number;
};

const MAX_RESULTS = 80;
const MAX_SESSIONS = 100;
const MAX_MESSAGES_PER_SESSION = 100;
const MAX_FILE_MATCHES = 40;

export async function searchMosaic(api: TuiPluginApi, query: string): Promise<SearchReport> {
  const directory = api.state.path.directory;
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => searchMemories(directory, query)),
    searchSessions(api, directory, query),
    searchFileContentResults(api, directory, query),
    api.client.find
      .files({ directory, query, type: "file", limit: MAX_FILE_MATCHES }, { throwOnError: true })
      .then((response) => searchFileNames(response.data, query)),
  ]);

  const results: SearchResult[] = [];
  const incomplete: SearchSource[] = [];
  const [memories, sessions, fileContents, fileNames] = outcomes;

  if (memories.status === "fulfilled") results.push(...memories.value);
  else incomplete.push("memories");

  if (sessions.status === "fulfilled") {
    results.push(...sessions.value.results);
    incomplete.push(...sessions.value.incomplete);
  } else {
    incomplete.push("sessions", "messages");
  }

  if (fileContents.status === "fulfilled") results.push(...fileContents.value);
  else incomplete.push("file contents");

  if (fileNames.status === "fulfilled") results.push(...fileNames.value);
  else incomplete.push("file names");

  return {
    results: dedupeResults(results).slice(0, MAX_RESULTS),
    incomplete: [...new Set(incomplete)],
  };
}

async function searchFileContentResults(api: TuiPluginApi, directory: string, query: string): Promise<SearchResult[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const responses = await Promise.all(
    terms.map((term) => api.client.find.text({ directory, pattern: escapeRegExp(term) }, { throwOnError: true })),
  );
  const matches = new Map<string, FileTextMatch>();
  for (const response of responses) {
    for (const match of response.data) {
      if (matchesQuery(match.lines.text, query)) matches.set(`${match.path.text}:${match.line_number}`, match);
    }
  }
  return searchFileContents([...matches.values()]);
}

function searchMemories(directory: string, query: string): SearchResult[] {
  const store = new MemoryStore();
  try {
    return store
      .all(directory)
      .filter((memory) => matchesQuery(memory.content, query))
      .map((memory) => ({
        kind: "memory" as const,
        id: memory.id,
        content: memory.content,
        scope: memory.scope,
        createdAt: memory.createdAt,
        useCount: memory.useCount,
      }));
  } finally {
    store.close();
  }
}

async function searchSessions(api: TuiPluginApi, directory: string, query: string): Promise<SearchBatch> {
  const response = await api.client.session.list({ directory, limit: MAX_SESSIONS }, { throwOnError: true });
  const sessions = response.data;
  const results: SearchResult[] = sessions
    .filter((session) => matchesQuery(`${session.title} ${session.directory}`, query))
    .map((session) => ({
      kind: "run" as const,
      sessionID: session.id,
      title: session.title,
      directory: session.directory,
      updatedAt: session.time.updated,
    }));

  const messages = await Promise.allSettled(
    sessions.map(async (session) => {
      const messageResponse = await api.client.session.messages(
        { sessionID: session.id, directory, limit: MAX_MESSAGES_PER_SESSION },
        { throwOnError: true },
      );
      return { session, messages: messageResponse.data };
    }),
  );
  let messagesIncomplete = false;

  for (const outcome of messages) {
    if (outcome.status === "rejected") {
      messagesIncomplete = true;
      continue;
    }

    for (const message of outcome.value.messages) {
      const text = message.parts.map(searchablePartText).filter(Boolean).join(" ");
      if (matchesQuery(text, query)) {
        results.push({
          kind: "message",
          sessionID: outcome.value.session.id,
          title: outcome.value.session.title,
          role: message.info.role,
          snippet: clip(text, 180),
          createdAt: message.info.time.created,
        });
      }

      for (const path of new Set(message.parts.flatMap(artifactPaths))) {
        if (!matchesQuery(path, query)) continue;
        results.push({
          kind: "artifact",
          path,
          sessionID: outcome.value.session.id,
          title: outcome.value.session.title,
        });
      }
    }
  }

  return {
    results,
    incomplete: messagesIncomplete ? ["messages"] : [],
  };
}

function searchFileContents(matches: readonly FileTextMatch[]): SearchResult[] {
  return matches.slice(0, MAX_FILE_MATCHES).map((match) => ({
    kind: "file" as const,
    path: match.path.text,
    line: match.line_number,
    snippet: clip(match.lines.text, 180),
  }));
}

function searchFileNames(paths: readonly string[], query: string): SearchResult[] {
  return paths
    .filter((path) => matchesQuery(path, query))
    .slice(0, MAX_FILE_MATCHES)
    .map((path) => ({
      kind: "file" as const,
      path,
      line: 0,
      snippet: "File name match",
    }));
}
