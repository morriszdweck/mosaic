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
- **Agent Swarm** — an orchestrator that decomposes a task and runs specialists
  in parallel, installed with Mosaic.
- **Scheduled tasks** — the agent can schedule a prompt to come back to itself
  later, in the same conversation.
- **First-launch setup** — pick a model in one keypress, including a free one
  that needs no account or card.
- **Personality** — a `SOUL.md` that shapes tone and standing preferences.
- **Its own face** — Mosaic's wordmark and example prompts replace the engine's,
  through its TUI slot API rather than by forking the interface.

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

## Agent Swarm

For work with several independent pieces, `swarm` decomposes the task and runs
specialists in parallel rather than doing it one step at a time:

```
Tab → swarm     (or /swarm)
```

> *"Build a dashboard with auth, charts and tests — research the libraries
> first, then parallelise the components."*

The orchestrator splits the request into units, delegates each to a specialist,
fires the independent ones together, and synthesises the results. Specialists:

| Agent | Role |
| --- | --- |
| `swarm` | Orchestrator. Decomposes, delegates, coordinates, synthesises. |
| `researcher` | Finding things out: sources, options, prior art. |
| `reviewer` | Checks work for correctness, gaps, and unstated assumptions. |
| `optimizer` | Makes something smaller, faster, cheaper, or clearer. |
| `uiux-designer` | How the result is presented and structured. |

Upstream swarm is written for coding work. Mosaic ships general versions of the
same roles — a reviewer that checks an argument as readily as a diff, an
optimizer that tightens a process as readily as a hot loop — and layers them
over the vendored copy, which stays untouched so re-fetching it is safe.

Agent Swarm builds on [opencode-swarm](https://github.com/morriszdweck/opencode-swarm),
fetched by the installer into `vendor/swarm` and synced into Mosaic's own agent
directory on each launch. Its own installer targets `~/.config/opencode`, which
is the OpenCode install Mosaic keeps out of — this route keeps that separation.

Those five names are effectively reserved. If you already have an agent with one
of them, Mosaic keeps yours and says so rather than overwriting it; the rest
still install.

Parallel agents are not free — each specialist is its own run. A swarm earns
that on work with genuinely independent pieces, not on a one-line edit.

## Scheduled tasks

Ask for something later and the agent schedules it itself:

> *"Check the build again in ten minutes and tell me if it's still failing."*

It calls a `schedule` tool, and when the time comes the prompt is submitted as a
real message **in the same conversation**. The follow-up run therefore starts
with the context it was planning against — no re-briefing, and no fresh session
that has to be told what the task was about.

```
schedule add     when = "in 10m", "every 2h", "at 14:30"
schedule list    what is pending here
schedule cancel  by id
```

A repeat reschedules from when it fires, not from the time it missed, so a
Mosaic that was closed for a week does not come back and fire the same task a
hundred times catching up.

**It only fires while Mosaic is running.** Tasks are bound to a live session —
that is what makes them arrive in context. For something that must happen
whether or not Mosaic is open, use cron with `mosaic run`. The tool description
says this too, so the agent offers cron instead of promising a 3am reminder from
a closed laptop.

## Personality

Drop a `SOUL.md` in `~/.mosaic/` and it is appended to Mosaic's own instructions
— last, so it wins:

```markdown
Call me Morris. Be blunt; skip the preamble.
Default to metric. When you are guessing, say so.
```

## Token efficiency

The features that cost tokens are the ones worth being careful about:

| | Typical approach | Mosaic |
| --- | --- | --- |
| Memory | Load `MEMORY.md` + `USER.md` in full, every turn | Score against the message, inject top matches under a character budget |
| Irrelevant question | Still pays for the whole memory file | Pays nothing — no match, no injection |
| 1000 memories | Cost grows with the store | Same per-turn cost as 10 |
| Wide exploration | Lands in the main history | Runs in a subagent; only the conclusion returns |
| Titles, summaries, compaction | Main model | `small_model`, set for you at setup |
| Free tier background work | Engine's own pick, sometimes slow | The same model you chose |

Setup pairs a cheap companion model automatically — Haiku alongside Sonnet,
`gpt-4o-mini` alongside `gpt-4o`. Background work runs constantly and does not
need the expensive model.

## Configuration

`~/.mosaic/config.json` is merged over Mosaic's defaults on every start, and a
`.mosaic/config.json` or `mosaic.json` beside your work is layered on top of
that. Arrays concatenate and agents merge by name, so adding to it extends
Mosaic rather than replacing what makes it Mosaic:

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

Interface settings are separate. The TUI reads its own `tui.json`, and it is the
only half that loads a plugin's `tui` hooks — a plugin listed in the agent config
gets its `server` half loaded and its interface half silently ignored.

Mosaic reads only its own filenames. The engine finds project config by walking
up for `opencode.json` and `.opencode/`, which meant an OpenCode user's
providers appeared inside Mosaic; that discovery is turned off and replaced with
`.mosaic/config.json` and `mosaic.json`.

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
src/plugin/branding/       wordmark and example prompts, via TUI slots
src/plugin/schedule/       the schedule tool and its timer
src/swarm.ts               syncs Swarm's agents into Mosaic's config
agents/                    Mosaic's general-purpose Agent Swarm definitions
skills/agent-swarm/        the Agent Swarm skill
vendor/swarm/              opencode-swarm checkout (fetched by install.sh)
src/setup/                 first-launch model picker
prompts/mosaic.md          base system instructions
```

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
