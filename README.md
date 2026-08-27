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
- **Mosaic plugins** — GitHub packages that bundle skills and optional tools,
  with a copyable installation prompt so an agent can install them for you.
- **Kimi WebBridge browser access** — the `kimi-webbridge` skill and `/browser`
  connection check are included; the command reports when WebBridge is ready
  or points you to the official Chrome extension.
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
`~/.local/bin/mosaic`. Each `mosaic` invocation refreshes that install from
GitHub before starting; set `MOSAIC_SKIP_UPDATE=1` to launch the current
install without refreshing it.


## Quick start


```sh
mosaic providers      # add a key for any provider you already use
mosaic                # start the TUI
mosaic run "..."      # one-shot, no TUI
```


Inside the TUI, run `/browser` to check Kimi WebBridge. If it is not connected,
the agent will give you the Chrome extension link needed to connect your
browser.


Try one of these:


```text
Summarise these three papers and tell me where they disagree.
Plan this migration, then list the risks I should decide on.
Read this CSV and explain what it actually measures.
Split this launch plan among the right specialists and bring me one answer.
```


## Plugins

A Mosaic plugin is one GitHub repository containing a `mosaic-plugin.json` manifest, optional tool entrypoint, and optional bundled skills. Mosaic owns the package format and install workflow.

```sh
mosaic plugins list
mosaic plugins install https://github.com/OWNER/REPOSITORY
```

You can also open a plugin repository, copy its **Install with Mosaic** prompt, and paste it into an agent. Restart Mosaic after installation. To create a plugin, ask Mosaic to use its built-in `plugin-creator` skill; it will shape the manifest, package contents, README, and installation prompt.

Only install repositories you trust: plugin tools and dependency installation can execute code on your machine.
