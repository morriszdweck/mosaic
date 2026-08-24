import type { AuthStore } from "../auth/store.ts";
import { isExpired, refreshToken } from "../auth/codex.ts";
import type { ChatRequest, Provider, StreamEvent } from "../types.ts";
import { OpenAICompatibleProvider } from "./openai.ts";

/**
 * Codex provider: ChatGPT Codex subscription via OAuth.
 * Uses the stored OAuth token (auto-refreshing) against OpenAI's chat endpoint.
 */

export interface CodexProviderOptions {
  store: AuthStore;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class CodexProvider implements Provider {
  readonly name = "codex";
  private readonly store: AuthStore;
  private readonly baseUrl: string;
  private readonly fetchFn?: typeof fetch;

  constructor(options: CodexProviderOptions) {
    this.store = options.store;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchFn = options.fetchFn;
  }

  async *chat(request: ChatRequest): AsyncIterable<StreamEvent> {
    const credential = await this.store.get("codex");
    if (!credential || credential.kind !== "oauth") {
      yield {
        type: "error",
        error: new Error("Not signed in with ChatGPT. Run `mosaic login codex` to start the device flow."),
      };
      return;
    }

    let token = credential;
    if (isExpired(token)) {
      try {
        token = await refreshToken(token, this.store, "codex", undefined, this.fetchFn);
      } catch (error) {
        yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
        return;
      }
    }

    const inner = new OpenAICompatibleProvider({
      name: "codex",
      baseUrl: this.baseUrl,
      apiKey: token.accessToken,
      fetchFn: this.fetchFn,
    });
    yield* inner.chat(request);
  }
}

/**
 * OpenCode Go / Zen provider: paste-an-API-key flow.
 * Keys are stored via `mosaic login opencode` (or `mosaic login opencode --key ...`).
 * Wire format is OpenAI-compatible.
 */

export interface OpenCodeProviderOptions {
  store: AuthStore;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class OpenCodeProvider implements Provider {
  readonly name = "opencode";
  private readonly store: AuthStore;
  private readonly baseUrl: string;
  private readonly fetchFn?: typeof fetch;

  constructor(options: OpenCodeProviderOptions) {
    this.store = options.store;
    this.baseUrl = (options.baseUrl ?? "https://opencode.ai/zen/v1").replace(/\/$/, "");
    this.fetchFn = options.fetchFn;
  }

  async *chat(request: ChatRequest): AsyncIterable<StreamEvent> {
    const credential = await this.store.get("opencode");
    if (!credential || credential.kind !== "apikey") {
      yield {
        type: "error",
        error: new Error("No OpenCode API key. Run `mosaic login opencode` and paste your key."),
      };
      return;
    }
    const inner = new OpenAICompatibleProvider({
      name: "opencode",
      baseUrl: this.baseUrl,
      apiKey: credential.key,
      fetchFn: this.fetchFn,
    });
    yield* inner.chat(request);
  }
}
