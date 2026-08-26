# Changelog

## Unreleased

- Added Mosaic plugins: GitHub packages that bundle skills and optional tools, a `mosaic plugins` installer/list command, a `/plugins` in-app guide, and the built-in `plugin-creator` skill.

## 0.10.0

- Standing scheduled tasks: `schedule` with scope `standalone` registers a task
  with the operating system — launchd, a systemd user timer, or crontab — so
  "every weekday at 08:00" runs in its own session whether or not Mosaic is
  open, across quits and reboots.
- Calendar recurrences: "every day at 09:00", "every weekday at 08:30", "every
  monday at 17:00", "every mon and thu at 9am". Resolved against the local clock
  each time, so a wall time survives a late run and both DST changes.
- `mosaic tasks` lists, adds, runs, cancels, and shows the output of standing
  tasks from the shell, and reports when the OS scheduler has no Mosaic entry so
  a task that will never fire cannot look scheduled.
- A run whose next occurrence is already due is skipped rather than run late, so
  a machine that was asleep does not deliver yesterday's briefing just before
  today's.
- `MOSAIC_TASKS_SCHEDULER=none` for anyone who would rather wire
  `mosaic tasks run-due` into their own cron.

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
