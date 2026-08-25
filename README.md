# Mosaic

A terminal AI agent, from scratch — inspired by Nous Research's Hermes Agent. Same feature class (chat, tools, memory, skills, providers), three differentiators:

1. **Bring your own key** — a dozen providers built in, each just a base URL and a key. `mosaic login <provider>`, an env var, or one stanza of TOML for anything else. No YAML archaeology.
2. **Token efficiency as a first-class design goal** — lazy tool schemas, aggressive truncation, auto-compaction, subagent isolation, prompt-cache-friendly layout, live token meter.
3. **Easy to use** — sensible defaults, no mandatory config file. Install, log in, go.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
```

Builds available for macOS (arm64 + x64) and Linux (arm64 + x64). On Windows, use WSL2.

This installs two files: a launcher at `~/.local/bin/mosaic` and the binary at
`~/.local/libexec/mosaic/mosaic-bin`. The launcher starts the binary from its own
directory, because Bun executables run the `preload` entries of whatever
`bunfig.toml` sits in the current directory — so launching mosaic directly inside
an untrusted repo would run that repo's code in-process. Set `MOSAIC_INSTALL_DIR`
and `MOSAIC_LIBEXEC_DIR` to relocate either half; the launcher finds the binary
relative to itself, so moving the pair together is fine.

Or build from source (requires [Bun](https://bun.sh)):

```sh
git clone https://github.com/morriszdweck/mosaic
cd mosaic
bun install
bun run compile   # → ./mosaic binary
```

A from-source binary is the bare executable, without the launcher. Run it from a
directory with no `bunfig.toml`, or pass `--cwd` to point it at your project.

## Quick start

```sh
mosaic providers              # what's built in, and what's ready to use
mosaic login openai           # paste a key (stored 0600 in ~/.mosaic/auth.json)
mosaic                        # start the TUI
mosaic -p "explain this repo" # headless one-shot
```

Or skip the login entirely — export a key and go:

```sh
export ANTHROPIC_API_KEY=...
mosaic -m anthropic:claude-sonnet-4-5
```

Keys resolve as **config.toml > env var > saved login**, so a variable in your
shell always overrides what you logged in with.

## Providers

Every provider is an API key plus a base URL — run `mosaic providers` for the
live list and which ones you already have keys for.

| Provider    | Key                                                   |
| ----------- | ----------------------------------------------------- |
| OpenAI      | `OPENAI_API_KEY`                                      |
| Anthropic   | `ANTHROPIC_API_KEY`                                   |
| OpenRouter  | `OPENROUTER_API_KEY`                                  |
| Groq        | `GROQ_API_KEY`                                        |
| DeepSeek    | `DEEPSEEK_API_KEY`                                    |
| Together    | `TOGETHER_API_KEY`                                    |
| Mistral     | `MISTRAL_API_KEY`                                     |
| xAI         | `XAI_API_KEY`                                         |
| Fireworks   | `FIREWORKS_API_KEY`                                   |
| Cerebras    | `CEREBRAS_API_KEY`                                    |
| Ollama      | keyless, `http://localhost:11434`                     |
| LM Studio   | keyless, `http://localhost:1234`                      |

Anything else that speaks the OpenAI API works too:

```toml
[providers.myhost]
base_url = "https://my-endpoint/v1"
api_key_env = "MYHOST_API_KEY"
```

Models are referenced as `provider:model`, e.g.:

```sh
mosaic -m anthropic:claude-sonnet-4-5
mosaic -m ollama:llama3.1
```

## TUI

- **`@` file references** — fuzzy-pick a file; its contents go to the model, not just the name
- **`!` shell** — run a command inline; the output joins the conversation
- **`/` commands** with fuzzy autocomplete, and a **ctrl+p** command palette
- **Themes** — tokyonight, catppuccin, gruvbox, nord (`/theme`)
- **Sessions browser** — `/sessions` to search and resume; `/export` to markdown
- Streaming markdown, syntax-highlighted code, diff-coloured edit panels
- Permission prompts: **y** allow once · **a** always allow · **n** deny
- **Esc** interrupts mid-turn; type a redirect and continue from the same context
- Status bar: model, context meter, tokens in/out, session cost

Keys — **ctrl+x** is the leader:

| Key | |
| --- | --- |
| `ctrl+p` | Command palette |
| `ctrl+x f` | Insert a file reference |
| `ctrl+x s` | Sessions |
| `ctrl+x m` / `t` | Model / theme |
| `ctrl+x k` / `c` | Compact / clear |
| `ctrl+x g` / `G` | Jump to top / bottom |
| `enter` | Send (`shift+enter` for a newline) |
| `esc` | Interrupt, or close an overlay |
| `ctrl+c` ×2 | Quit |

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
