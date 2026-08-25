---
name: customize-opencode
---

# Not applicable in Mosaic

This shadows a skill built into the engine, which cannot be removed from
configuration. The original instructs an agent to edit `opencode.json` and
files under `~/.config/opencode` — paths that belong to a **separate OpenCode
install** and that Mosaic must never touch. Following it here would edit the
wrong program's configuration.

It is shipped without a description so it is not offered as a choice. If you
have loaded it anyway, stop and load **`customize-mosaic`** instead: that
covers Mosaic's own layout under `~/.mosaic`, its config keys, agents, skills,
themes, and personality.
