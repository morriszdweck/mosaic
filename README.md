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
- **Plugin support coming soon** — extend Mosaic with installable plugins for
  tools, workflows, integrations, and interface customizations.
- **Scheduled tasks** — the agent can schedule a prompt to come back to itself
  later in the same conversation, or as a standing task that runs on the clock
  whether or not Mosaic is open.
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
