---
name: mosaic-self
description: Use when asked to watch, monitor, or keep checking something on an interval, to remember how the user wants you to behave, to change your own tone or personality, or to write down a procedure so you do it the same way next time. Covers the heartbeat, soul, and skill tools.
---

# Watching, remembering, and changing yourself

Three tools change what you do beyond this turn. They are easy to overuse: each
one costs tokens on every future turn, so the bar is "will this still matter
next week".

## Heartbeat — keep checking something

`heartbeat` runs a standing check on an interval until the session ends. Each
beat arrives as a message in this conversation, so you keep the context and can
compare against what you saw last time. The user can talk to you in between; a
beat is just another turn.

Start one when the user wants something watched — a build, a queue, a file, a
page, a directory — rather than asked about once.

Write the `watch` instruction so a quiet beat is cheap:

> Check whether `dist/` changed and whether the last test run still passes.
> If neither changed, say "no change" and stop.

That matters because the interval is what you pay. A beat that re-reads
everything costs the same whether or not anything happened; a beat that can
exit on "nothing changed" costs almost nothing most of the time.

Pick the interval from how fast the thing actually changes. A build that takes
eight minutes does not want a one-minute heartbeat.

A heartbeat only runs while Mosaic is open. If the user needs something to
happen whether or not Mosaic is running — every morning, every Monday, any time
of day — that is `schedule` with `scope: "standalone"`, not a heartbeat. Those
are registered with the OS scheduler and run in their own session, so write the
prompt to stand alone: name the files, paths, and criteria in full, because
nothing from this conversation comes with it.

Stop it when the reason for it is gone. Do not leave a heartbeat running past
the task that justified it.

## Soul — how you talk

`soul` reads and rewrites `SOUL.md`: name, tone, standing preferences,
conventions the user has asked for more than once.

It belongs here when it is about *you* and it is durable. "Be blunt", "always
metric", "call me Morris". Facts about a project go in `memory`; anything that
only matters today goes nowhere.

Writing replaces the whole file, so read it first and keep what still applies.
Ask before changing it unless the user asked you to — it is their voice.

## Skill — do it the same way next time

`skill` writes a markdown document you can load later. Write one when you have
worked out a procedure that will recur: a report format, a release checklist, a
house style, the shape of a task the user keeps asking for.

The description decides whether it is ever found again. Say what it does *and*
when to use it, front-loading the words the user would actually say. A skill
with a vague description is a skill that never loads.

Keep the body specific. The reason to move detail into a skill is that it stays
out of context until it is needed — a skill that restates general good practice
costs tokens and teaches nothing.

## All three need a restart

Config, skills, and SOUL.md are read once when Mosaic starts. After writing any
of them, say plainly that it applies from the next start.
