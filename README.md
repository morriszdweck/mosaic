# Mosaic

A terminal AI agent, from scratch — inspired by Nous Research's Hermes Agent. Same feature class (chat, tools, memory, skills, providers), three differentiators:

1. **Frictionless provider onboarding** — Codex OAuth device flow (sign in with ChatGPT), OpenCode key paste, or standard API keys. No YAML archaeology.
2. **Token efficiency as a first-class design goal** — lazy tool schemas, aggressive truncation, auto-compaction, subagent isolation, prompt-cache-friendly layout, live token meter.
3. **Easy to use** — sensible defaults, no mandatory config file. Install, log in, go.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
```

Builds available for macOS (arm64 + x64) and Linux (arm64 + x64). On Windows, use WSL2.

Or build from source (requires [Bun](https://bun.sh)):

```sh
git clone https://github.com/morriszdweck/mosaic
cd mosaic
bun install
bun run compile   # → ./mosaic binary
```

## Quick start

```sh
mosaic login codex        # sign in with ChatGPT (device flow, no API key)
mosaic                    # start the TUI
mosaic -p "explain this repo"   # headless one-shot
```

Other ways to authenticate:

```sh
mosaic login opencode                        # paste an OpenCode Go/Zen key
mosaic login openai --key sk-...             # any standard API key
export ANTHROPIC_API_KEY=...                 # env vars work too
```

## Providers

| Provider    | How                                                   |
| ----------- | ----------------------------------------------------- |
| OpenAI      | `OPENAI_API_KEY` or `mosaic login openai`             |
| Anthropic   | `ANTHROPIC_API_KEY` or `mosaic login anthropic`       |
| Codex       | `mosaic login codex` — OAuth device flow              |
| OpenCode    | `mosaic login opencode` — paste key                   |
| OpenRouter  | `OPENROUTER_API_KEY`                                  |
| Groq        | `GROQ_API_KEY`                                        |
| Ollama      | keyless, `http://localhost:11434`                     |
| LM Studio   | keyless, `http://localhost:1234`                      |
| Any OpenAI-compatible endpoint | `[providers.x] base_url = "…"` in config |

Models are referenced as `provider:model`, e.g.:

```sh
mosaic -m anthropic:claude-sonnet-4-5
mosaic -m ollama:llama3.1
```

## TUI

- Multiline editor with slash-command autocomplete: `/model` `/login` `/clear` `/compact` `/resume` `/cost` `/memory` `/help`
- Streaming markdown rendering, syntax-highlighted code, tool-call panels
- Permission prompts: **y** allow once · **a** always allow · **n** deny
- **Esc** interrupts mid-turn; type a redirect and continue from the same context
- Status bar: model, context usage %, tokens in/out, session cost
- **Ctrl+C** twice to quit

## Sessions

SQLite + JSONL transcripts under `~/.mosaic/`. Crash-safe, resumable:

```sh
mosaic -c                # continue most recent session
mosaic --resume <id>     # resume a specific one
mosaic sessions          # list them
```

## Tools

`bash` (background tasks + timeout) · `read` (windowed, never whole files) · `write` · `edit` (diff hunks) · `glob` · `grep` · `web_fetch` · `web_search` (DuckDuckGo keyless default; Brave/Tavily via config) · `todo` · `memory` · `skill` · `agent` (subagents with isolated context) · MCP servers (stdio)

## Token efficiency

- **Lazy tool schemas** — heavy descriptions injected only when relevant
- **Aggressive truncation** — tool output capped with head/tail elision
- **Auto-compaction** — at ~80% context, older turns are summarized; the last few stay verbatim
- **Subagent isolation** — exploration happens in a subagent; only conclusions return
- **Prompt caching** — stable system-prompt prefix + cache markers (Anthropic/OpenAI)
- **Diff-based edits** — hunks, not whole files
- **Token meter** — live accounting in the status bar and `/cost`

## Configuration

Everything is optional. `~/.mosaic/config.toml` (project overrides in `.mosaic/config.toml`):

```toml
model = "anthropic:claude-sonnet-4-5"
small_model = "openai:gpt-4o-mini"   # used for compaction + subagents
max_tokens = 8192

[providers.ollama]
base_url = "http://localhost:11434/v1"

[tokens]
context_window = 200_000
compact_at = 0.8
keep_last_turns = 4
lazy_tool_schemas = true

[permissions]
mode = "ask"   # ask | allow-read-only | yolo

[search]
backend = "duckduckgo"   # duckduckgo | brave | tavily
```

## Memory & skills

- **Persistent memory**: facts/preferences stored in SQLite, recalled by keyword relevance — never stuffed wholesale into context. Manage with the `memory` tool or `/memory`.
- **Project memory**: `MOSAIC.md` / `AGENTS.md` auto-loaded (walked up to repo root, size-capped).
- **Skills**: drop a directory with a `SKILL.md` into `~/.mosaic/skills/` or `.mosaic/skills/`; the agent loads it on demand via the `skill` tool.

## Development

```sh
bun install
bun run test        # unit + golden-file + mock-provider E2E
bun run typecheck
bun run dev         # run the TUI from source
```

Layout:

```
packages/
  core/   # agent loop, tools, providers, memory, sessions — no UI deps
  tui/    # OpenTUI (SolidJS) front-end
  cli/    # entrypoint, auth commands, headless mode
```

## License

MIT
