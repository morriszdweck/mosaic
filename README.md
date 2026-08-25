# Mosaic

**Think in pieces. Act as one.**

Mosaic is a terminal workspace for work that does not fit in one box: research,
writing, analysis, code, and the messy work between them. It remembers how you
work, can return to a task later, and can turn a genuinely wide problem into a
coordinated team of specialists.

It is for people who want one capable collaborator in the terminal — not a
coding tool pretending every problem is a repository.

```sh
curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
mosaic
```

Mosaic adds:

- **General-purpose agents** — a `mosaic` primary agent plus `research`,
  `writer`, `analyst`, and `coder` subagents, each with its own prompt.
- **Persistent memory** — facts that survive across conversations, recalled by
  relevance and injected under a strict token budget.
- **A separate workspace** — config, sessions, and credentials live in
  `~/.mosaic`, separate from other terminal agents.
- **Agent Swarm** — an orchestrator that decomposes a task and runs specialists
  in parallel, installed with Mosaic.
- **Scheduled tasks** — the agent can schedule a prompt to come back to itself
  later, in the same conversation.
- **First-launch setup** — pick a model in one keypress, including a free one
  that needs no account or card.
- **Personality** — a `SOUL.md` that shapes tone and standing preferences.
- **A point of view** — Mosaic starts from questions, plans, evidence, and
  drafts; code is there when it is the right tool.
- **Its own face** — a blue Mosaic theme, wordmark, and example prompts replace
  the engine's, through its TUI slot API rather than by forking the interface.

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

Try one of these:

```text
Summarise these three papers and tell me where they disagree.
Plan this migration, then list the risks I should decide on.
Read this CSV and explain what it actually measures.
Split this launch plan among the right specialists and bring me one answer.
```

Mosaic works with the keys and local models you already use — Anthropic, OpenAI,
OpenRouter, Groq, Ollama, LM Studio, and anything else its provider stack
supports. It also offers a free first-launch option with no account; availability
varies, so use your own provider for work that cannot wait. `mosaic models`
lists what is available.

## Agents

| Agent | Role |
| --- | --- |
| `mosaic` | Primary. General assistant across research, writing, analysis, code, and system tasks. |
| `researcher` | Gathers from files, web, and commands. Returns findings with citations, not transcripts. |
| `writer` | Drafts and edits long-form prose in the author's voice. |
| `analyst` | Works with data: inspects it before describing it, states its assumptions. |
| `builder` | Makes things: code, configs, scripts, files. Runs what it builds. |
| `reviewer` | Checks work for correctness, gaps, and unstated assumptions. |
| `optimizer` | Makes something smaller, faster, cheaper, or clearer. |
| `designer` | How a result is presented and structured. |
| `swarm` | Orchestrator — see below. |

Names avoid stating a trade the role is not limited to: `builder` rather than
`coder`, `designer` rather than `uiux-designer`. The engine's own `build` agent
is disabled — it is a coding primary that competes with `mosaic` for the default
slot. `plan` stays, since sequencing is general and the swarm delegates to it.

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

When a task has real independent parts, `swarm` turns Mosaic into a small,
coordinated team. It decomposes the work, starts the right specialists in
parallel, and returns one considered answer rather than a pile of transcripts:

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
| `designer` | How the result is presented and structured. |
| `plan` | Sequencing work and finding dependencies. |

Mosaic's specialists are general by design: the reviewer checks an argument as
readily as a diff, and the optimizer tightens a process as readily as a hot
loop.

Agent Swarm is installed with Mosaic and kept in Mosaic's own configuration.
Mosaic layers its general-purpose specialists over the upstream swarm roles,
without overwriting specialist files you already own.

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

## Watching, and changing itself

Mosaic can change what it does beyond the current turn:

- **`heartbeat`** — a standing check on an interval. Each beat arrives as a
  message in the same conversation, so it keeps context and compares against
  what it saw last time; you can talk to it in between. One per conversation,
  and only while Mosaic is open.
- **`soul`** — read and rewrite `SOUL.md`, its standing voice.
- **`skill`** — write a markdown skill it can load later, so a procedure worked
  out once is done the same way next time.

All three are plain files under `~/.mosaic` that you can read and edit, and all
three apply from the next start. The `mosaic-self` skill tells the agent when
each is worth using — the bar being whether it will still matter next week.

`customize-mosaic` covers configuring Mosaic itself.

## Checkpoints

The first time the agent writes to a file in a turn, its contents are copied
aside. `checkpoint restore` puts them back:

```
checkpoint list      what has been captured in this conversation
checkpoint restore   put every file in a checkpoint back
checkpoint create    start a fresh point before a risky batch of edits
```

Capture is automatic, because an undo you have to remember to arm is not an
undo. It covers only the files the agent actually touches — snapshotting a whole
project on every edit is slow enough that people switch it off, and a disabled
safety net is worse than an honest absence of one.

A file is captured once per checkpoint, on first touch, so the way back is the
state before the *first* change rather than the most recent one. A file that did
not exist is restored by deleting it again.

## Event hooks

Drop a `.ts` file in `~/.mosaic/hooks/` and Mosaic calls it. This is the
guardrail seam — refuse a command, log what ran, notify on completion — without
writing a plugin:

```ts
// ~/.mosaic/hooks/no-force-push.ts
export function beforeTool({ tool, args, deny }) {
  if (tool === "bash" && String(args.command).includes("push --force")) {
    deny("force pushes are blocked by a local hook")
  }
}
```

Handlers: `beforeTool` (can `deny`), `afterTool`, `onMessage`. A hook that throws
is reported and skipped rather than taking the turn down — your logging being
broken should not stop you working. `deny` is the exception: that is the hook
doing its job, and it stops the tool.

## Credential pools

Several keys for one provider, used in turn:

```json
{ "keys": { "anthropic": ["sk-a", "sk-b"], "groq": ["gsk-1", "gsk-2"] } }
```

Rate limits are per key, so the usual failure is not "no access" but "not right
now". Rotation is round-robin per request rather than only-on-failure, which
spreads load instead of hammering one key until it trips.

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

## Theme

Mosaic ships two themes and uses `mosaic` by default in place of the engine's
own: deep navy grounds with a light-blue accent, in light and dark variants.
`mosaic-dark` is the same identity on near-black, for low-light terminals.
The other built-in themes are still there — `/theme` to switch, or set `theme`
in `~/.mosaic/config/opencode/tui.json`.

Add your own as `themes/<name>.json` in that directory; the filename is the
theme name.

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

## Engine and attribution

Mosaic runs on the published [OpenCode](https://github.com/sst/opencode) engine.
It keeps the engine's terminal interface, agent loop, tool system, and provider
stack while owning its experience: its prompts, agents, memory, scheduling,
setup, configuration, and visual identity. Mosaic does not fork or vendor the
engine, so upstream fixes arrive with a version bump rather than a merge.

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
src/plugin/schedule/       the schedule and heartbeat tools
src/plugin/evolve/         the soul and skill tools
src/plugin/checkpoint/     file snapshots and rollback
src/plugin/hooks/          loads ~/.mosaic/hooks/*.ts
src/plugin/keypool/        rotates several keys for one provider
skills/                    skills Mosaic ships
themes/                    mosaic and mosaic-dark
src/swarm.ts               syncs Swarm's agents into Mosaic's config
agents/                    Mosaic's general-purpose Agent Swarm definitions
skills/agent-swarm/        the Agent Swarm skill
vendor/swarm/              opencode-swarm checkout (fetched by install.sh)
src/setup/                 first-launch model picker
prompts/mosaic.md          base system instructions
```

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
