# Changelog

## 0.9.0

- Checkpoints: file contents are captured before the agent's first write in a
  turn, and `checkpoint restore` puts them back.
- Event hooks: `.ts` files in `~/.mosaic/hooks/` run at points in a turn and can
  refuse a tool call.
- Credential pools: several keys per provider, rotated round-robin.
- Both engine footers are now replaced, including the sidebar one still visible
  inside a session.

## 0.7.1

- Mosaic theme, used by default in place of the engine's own: deep navy grounds
  with a light-blue accent, in light and dark.
- Agent names no longer state a trade the role is not limited to — `coder`
  becomes `builder`, `uiux-designer` becomes `designer`, and the duplicate
  `research`/`researcher` pair collapses to one.
- The engine's `build` agent is disabled; `plan` stays and the swarm uses it.
- Free-tier disclosure in setup is stated once, plainly, rather than as branding.

## 0.7.0

Mosaic's first focused release as a terminal workspace for general work.

- Added Agent Swarm: a coordinator and specialist roles for research, analysis,
  writing, review, optimisation, presentation, and implementation.
- Made Swarm general-purpose, so it can split a launch plan or research brief
  as naturally as a coding task.
- Added a persistent-memory plugin, in-session scheduled tasks, first-launch
  model setup, and Mosaic-owned state under `~/.mosaic`.
- Sharpened Mosaic's terminal identity and onboarding around its core idea:
  **think in pieces. act as one.**

## 0.6.2 and earlier

Earlier releases established Mosaic's independent launcher, configuration,
general-purpose agents, and terminal interface.
