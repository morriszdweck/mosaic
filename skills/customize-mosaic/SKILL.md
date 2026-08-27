---
name: customize-mosaic
description: Use when configuring Mosaic itself — models, agents, themes, skills, plugins, SOUL.md, memory, heartbeats, or anything under ~/.mosaic. Also use when the user asks to change how Mosaic behaves, looks, or what it can do. Not for the user's own projects.
---

# Customizing Mosaic

Mosaic is a distribution over the OpenCode engine. Its own files live under
`~/.mosaic`; **`~/.config/opencode` belongs to a separate OpenCode install and
must not be touched.**

Config is read once at startup. After any change here, tell the user to restart
Mosaic.

## Where things live

| What | Path |
| --- | --- |
| User config | `~/.mosaic/config.json` |
| Project config | `.mosaic/config.json` or `mosaic.json`, nearest wins |
| Personality | `~/.mosaic/SOUL.md` |
| Skills | `~/.mosaic/config/opencode/skill/<name>/SKILL.md` |
| Agents | `~/.mosaic/config/opencode/agent/<name>.md` |
| Themes | `~/.mosaic/config/opencode/themes/<name>.json` |
| Interface settings | `~/.mosaic/config/opencode/tui.json` |
| Memory | `~/.mosaic/memory.db` |
| Native plugins | `~/.mosaic/config/opencode/plugin(s)/` or the `plugin` array |
| Generated config | `~/.mosaic/mosaic.json` — **rewritten every launch, never edit** |

## config.json

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "agent": { "mosaic": { "model": "anthropic/claude-opus-4-1" } },
  "instructions": ["~/notes/house-style.md"],
  "plugin": ["opencode-example-plugin"]
}
```

Two things that bite:

- **Keys are singular** — `agent`, `plugin`, `provider`. Not the plural forms.
- **Unknown keys are dropped silently.** A typo costs you the setting with no
  error, so check spelling against a key that is known to work.

Arrays concatenate and agents merge by name, so adding to `config.json` extends
Mosaic rather than replacing what it ships.

## Changing behaviour

- **Voice and standing preferences** → the `soul` tool, or edit `SOUL.md`.
- **A procedure worth reusing** → the `skill` tool. Detail stays out of context
  until the description matches.
- **A recurring fact about the user or a project** → the `memory` tool, not a file.
- **A new agent** → a markdown file in the agent directory, frontmatter
  `description`, `mode` (`primary`/`subagent`/`all`), optional `model`, `color`.
  The body is its prompt.
- **A standing check** → the `heartbeat` tool.
- **Interface** → `tui.json`: `theme`, `keybinds`. Themes are JSON files whose
  filename is the theme name.

## Interface settings are separate

`tui.json` is not `config.json`, and only `tui.json` loads a plugin's interface
half. A plugin that draws something must be listed there or it is accepted,
reported as loaded, and silently never drawn.

## Native plugins

Mosaic carries OpenCode's native plugin architecture through unchanged. A
plugin is an npm package or local JavaScript/TypeScript module with
`package.json` as its manifest; there is no `mosaic-plugin.json` or
`~/.mosaic/plugins` store.

Install a package globally for Mosaic with:

```sh
mosaic plugin <npm-package-or-git-spec> --global
```

The compatibility form `mosaic plugins install <npm-package-or-git-spec>`
translates to the same native OpenCode command. A package that bundles skills
should expose a native `config` hook that adds its `skills/` directory to
OpenCode's skill paths. Local plugins can also live in
`~/.mosaic/config/opencode/plugin(s)/`, where OpenCode discovers them.

User-installed packages and local plugins are loaded after Mosaic's shipped
server plugins. Restart after changing a plugin or its package spec. Only
install code the user trusts: native plugin code and its dependencies execute
inside Mosaic.

The built-in `plugin-creator` skill scaffolds this native package layout and
entrypoint. It does not create a Mosaic-specific manifest or installer.

## The engine's own skill

`customize-opencode` is shadowed by an inert stub. Its advice applies to a
separate OpenCode install, not to Mosaic. If it ever loads, ignore it and use
this skill instead.

## Before changing anything

Read the current file first and preserve what the user did not ask to change.
Prefer a new file — an agent, a skill, a theme — over piling everything into
`config.json`. Say what you changed, where, and that a restart is needed.
