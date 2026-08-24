import { z } from "zod";
import type { Tool } from "./registry.ts";
import { truncateMiddle } from "./truncate.ts";
import type { SearchConfig } from "../config.ts";

/**
 * web_fetch + web_search (pluggable backend; DuckDuckGo keyless by default).
 */

const fetchSchema = z.object({
  url: z.string().describe("URL to fetch."),
  max_chars: z.number().optional().describe("Max characters of extracted text to return."),
});

export const webFetchTool: Tool<z.infer<typeof fetchSchema>> = {
  name: "web_fetch",
  summary: "Fetch a URL and return its text content (HTML stripped).",
  description:
    "Fetch a web page and return readable text: tags, scripts, and styles stripped, whitespace normalized. " +
    "Output is character-capped. Use for documentation, articles, API references.",
  keywords: ["web", "fetch", "url", "http", "page", "website", "download"],
  readOnly: true,
  schema: fetchSchema,
  async execute(input, ctx) {
    const res = await fetch(input.url, {
      headers: { "user-agent": "Mosaic/0.1 (+https://github.com/morriszdweck/mosaic)" },
      signal: ctx.signal,
    }).catch((error: unknown) => {
      throw new Error(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!res.ok) return `HTTP ${res.status} fetching ${input.url}`;
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = contentType.includes("html") ? htmlToText(raw) : raw;
    const cap = Math.min(input.max_chars ?? ctx.outputLimit, ctx.outputLimit);
    const capped = truncateMiddle(text, { maxChars: cap });
    return capped.text || "(empty response)";
  },
};

/** Crude but effective HTML → text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article|header|footer)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const searchSchema = z.object({
  query: z.string().describe("Search query."),
  max_results: z.number().optional().describe("Max results (default 8)."),
});

export const webSearchTool: Tool<z.infer<typeof searchSchema>> = {
  name: "web_search",
  summary: "Search the web (DuckDuckGo keyless by default; Brave/Tavily via config).",
  description:
    "Search the web and return titles, URLs, and snippets. Default backend is keyless DuckDuckGo; " +
    "configure Brave or Tavily keys for higher-quality results. Follow up with web_fetch on promising URLs.",
  keywords: ["search", "web", "google", "lookup", "find online"],
  readOnly: true,
  schema: searchSchema,
  async execute(input, ctx) {
    const search = ctx.services.searchConfig as SearchConfig | undefined;
    const backend = search?.backend ?? "duckduckgo";
    const maxResults = input.max_results ?? 8;

    try {
      switch (backend) {
        case "brave":
          return await braveSearch(input.query, maxResults, search?.braveApiKey);
        case "tavily":
          return await tavilySearch(input.query, maxResults, search?.tavilyApiKey);
        default:
          return await duckDuckGoSearch(input.query, maxResults);
      }
    } catch (error) {
      return `Search failed (${backend}): ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

async function duckDuckGoSearch(query: string, maxResults: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Mosaic/0.1)" },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();

  const results: string[] = [];
  const resultRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let match: RegExpExecArray | null;
  while ((match = resultRe.exec(html)) && results.length < maxResults) {
    const href = match[1]!;
    const title = htmlToText(match[2] ?? "");
    const snippet = htmlToText(match[3] ?? "");
    // DDG wraps outbound links; unwrap uddg param.
    const unwrapped = href.match(/uddg=([^&]+)/);
    const finalUrl = unwrapped ? decodeURIComponent(unwrapped[1]!) : href;
    results.push(`${results.length + 1}. ${title}\n   ${finalUrl}\n   ${snippet}`.trim());
  }
  return results.length ? results.join("\n\n") : "No results.";
}

async function braveSearch(query: string, maxResults: number, apiKey?: string): Promise<string> {
  if (!apiKey) throw new Error("Brave search needs a key: set BRAVE_API_KEY or [search] brave_api_key");
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    { headers: { "x-subscription-token": apiKey, accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const results = (data.web?.results ?? []).slice(0, maxResults);
  return results.length
    ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ""}`.trim()).join("\n\n")
    : "No results.";
}

async function tavilySearch(query: string, maxResults: number, apiKey?: string): Promise<string> {
  if (!apiKey) throw new Error("Tavily search needs a key: set TAVILY_API_KEY or [search] tavily_api_key");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const results = (data.results ?? []).slice(0, maxResults);
  return results.length
    ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content ?? ""}`.trim()).join("\n\n")
    : "No results.";
}
