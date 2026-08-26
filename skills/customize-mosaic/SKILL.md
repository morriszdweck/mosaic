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
| Plugins | `~/.mosaic/plugins/<name>` |
| Generated config | `~/.mosaic/mosaic.json` — **rewritten every launch, never edit** |

## config.json

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "agent": { "mosaic": { "model": "anthropic/claude-opus-4-1" } },
  "instructions": ["~/notes/house-style.md"],
  "plugin": ["./my-plugin.ts"]
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

## Plugins

A Mosaic plugin is a GitHub repository that bundles one capability: skills, tools, or both. Install one with the shell command below, or open its repository, copy the **Install with Mosaic** prompt, and paste that prompt into an agent:

```sh
mosaic plugins install https://github.com/OWNER/REPOSITORY
```

Mosaic validates `mosaic-plugin.json`, keeps the package under `~/.mosaic/plugins`, loads tool entrypoints on the next start, and syncs bundled skills into Mosaic's skill directory. Use `mosaic plugins list` to inspect installed packages. Never copy a plugin into `~/.config/opencode`; that directory belongs to a separate OpenCode install.

The built-in `plugin-creator` skill can scaffold a plugin repository, including its manifest, README, bundled skills or tools, and the copyable installation prompt.

## The engine's own skill

`customize-opencode` is shadowed by an inert stub. Its advice applies to a
separate OpenCode install, not to Mosaic. If it ever loads, ignore it and use
this skill instead.

## Before changing anything

Read the current file first and preserve what the user did not ask to change.
Prefer a new file — an agent, a skill, a theme — over piling everything into
`config.json`. Say what you changed, where, and that a restart is needed.
