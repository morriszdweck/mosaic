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
- **OpenCode-native plugins** — npm or Git-backed packages that add tools,
  hooks, and skills through the same plugin architecture as OpenCode.
- **Kimi WebBridge browser access** — the `kimi-webbridge` skill and `/browser`
  connection check are included; the command reports when WebBridge is ready
  or points you to the official Chrome extension.
- **Scheduled tasks** — the agent can schedule a prompt to come back to itself
  later in the same conversation, or as a standing task that runs on the clock
  whether or not Mosaic is open.
- **Free tier** — start without an account or card and get access
  to a curated selection of cheap models from OpenCode Zen, including models such as
 Mosaic Free (Big pickle), MiMo, and more.
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


Inside the TUI:

- `/memory` opens the memory control center, where you can search remembered
  context and forget anything that is no longer useful.
- `/runs` opens the run history for the current directory, including sessions
  created by scheduled work.
- `/tasks` opens the scheduler control center, where you can review, pause,
  resume, edit, run, or cancel conversation, heartbeat, and standing tasks.
- `/search` searches the current directory's runs, messages, memories, files,
  and file artifacts, with previews for matching files.
- `/browser` checks Kimi WebBridge. If it is not connected, the agent will give
  you the Chrome extension link needed to connect your browser.


Try one of these:


```text
Summarise these three papers and tell me where they disagree.
Plan this migration, then list the risks I should decide on.
Read this CSV and explain what it actually measures.
Split this launch plan among the right specialists and bring me one answer.
```


## Plugins

Mosaic uses OpenCode's native plugin architecture. A plugin is a standard npm
package or local JavaScript/TypeScript module with `package.json` as its
manifest. Packages can provide tools and hooks, and can register bundled
`skills/` with OpenCode's native `skill` tool. There is no Mosaic-specific
manifest or package store.

```sh
mosaic plugin <npm-package-or-git-spec> --global
```

For example, a GitHub-hosted package can be installed with:

```sh
mosaic plugin opencode-example-plugin@git+https://github.com/OWNER/REPOSITORY.git --global
```

`mosaic plugins install <spec>` remains a compatibility alias for the native
command. You can also add a package to the `plugin` array in
`~/.mosaic/config.json`. Restart Mosaic after installation. Only install
plugins you trust: native plugin code and its dependencies execute in Mosaic.

Mosaic's branding is built into the repository and is force-loaded on every
launch; it is not a removable user plugin. Ask Mosaic to use its built-in
`plugin-creator` skill when you want to create a native plugin package.
