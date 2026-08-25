# Mosaic

A general-purpose AI agent for the terminal, built on the
[OpenCode](https://github.com/sst/opencode) engine.

OpenCode is an excellent coding agent. Mosaic keeps its engine — the TUI, agent
loop, tool system, and provider stack — and changes what it is *for*: research,
writing, analysis, and system work are first-class, with coding as one capable
subagent rather than the whole point.

Mosaic adds:

- **General-purpose agents** — a `mosaic` primary agent plus `research`,
  `writer`, `analyst`, and `coder` subagents, each with its own prompt.
- **Persistent memory** — facts that survive across conversations, recalled by
  relevance and injected under a strict token budget.
- **Its own state** — config, sessions, and credentials live in `~/.mosaic`, so
  Mosaic and OpenCode can coexist without touching each other.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
```

Requires [Bun](https://bun.sh). The installer clones this repo to
`~/.local/share/mosaic`, installs the engine as a dependency, and links
`~/.local/bin/mosaic`.

## Quick start

```sh
mosaic providers      # add a key for any provider you already use
mosaic                # start the TUI
mosaic run "..."      # one-shot, no TUI
```

Mosaic is bring-your-own-key and inherits the engine's provider support —
Anthropic, OpenAI, OpenRouter, Groq, local models via Ollama or LM Studio, and
anything else it speaks. `mosaic models` lists what is available.

## Agents

| Agent | Role |
| --- | --- |
| `mosaic` | Primary. General assistant across research, writing, analysis, code, and system tasks. |
| `research` | Gathers from files, web, and commands. Returns findings with citations, not transcripts. |
| `writer` | Drafts and edits long-form prose in the author's voice. |
| `analyst` | Works with data: inspects it before describing it, states its assumptions. |
| `coder` | Writes and changes code, runs tests, debugs. |

Subagents are a token-efficiency mechanism as much as a behavioural one: each
explores in its own context and returns only its conclusion, so a wide search
never lands in the main thread's history.

## Memory

Mosaic has a `memory` tool backed by SQLite at `~/.mosaic/memory.db`, holding
durable facts — who you are, how you prefer to work, project constraints,
corrections you have given.

The design constraint is what it *withholds*. An agent that pastes every
remembered fact into every request spends context on things irrelevant to the
question. Mosaic scores memories against your actual message and injects only
the top matches, capped by both count and characters:

- nothing relevant scores → nothing is injected, and memory costs zero tokens
- a store with a thousand memories costs the same per turn as one with ten
- near-duplicates replace each other, so repeating a preference does not let it
  crowd out everything else

Scoring is deliberately cheap — word overlap, with recency and prior usefulness
as tiebreakers. No embeddings and no extra model call, because it runs on every
turn.

Memories are scoped: `user` and `preference` facts apply everywhere, while
`project` facts only surface in the directory they were learned in.

## Configuration

`~/.mosaic/config.json` is merged over Mosaic's defaults on every start. Arrays
concatenate and agents merge by name, so adding to it extends Mosaic rather than
replacing what makes it Mosaic:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "agent": {
    "mosaic": { "model": "anthropic/claude-opus-4-1" }
  },
  "instructions": ["~/notes/house-style.md"]
}
```

It accepts every key the engine accepts — see
[opencode.ai/docs](https://opencode.ai/docs) — with two caveats: keys are
singular (`agent`, `plugin`), and unknown keys are dropped silently rather than
rejected, so a typo costs you the setting with no error.

## Relationship to OpenCode

Mosaic does not fork or vendor OpenCode. It depends on the published
`opencode-ai` package and configures it, which means upstream fixes and features
arrive with a version bump rather than a merge.

What lives in this repository is the part that makes it Mosaic: the launcher,
the agent definitions and prompts, the memory plugin, and the installer.

OpenCode is MIT licensed. See [NOTICE](NOTICE) for attribution.

## Development

```sh
bun install
bun test
bun run typecheck
./bin/mosaic
```

Point `MOSAIC_HOME` at a scratch directory to run against throwaway state:

```sh
MOSAIC_HOME=/tmp/mosaic-dev ./bin/mosaic
```

```
bin/mosaic                 launcher: sets up ~/.mosaic, generates config, execs the engine
src/config.ts              config generation + user overrides
src/agents.ts              agent definitions
src/plugin/memory/         the memory tool and its recall hook
prompts/mosaic.md          base system instructions
```

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
