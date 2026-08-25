---
name: agent-swarm
description: Agent Swarm — parallel multi-agent orchestration. Use when a task has several independent parts and would go faster delegated across specialists (researcher, analyst, writer, reviewer, optimizer, uiux-designer, coder) than done step by step.
---

# Agent Swarm

Instead of one agent working through a task in sequence, Agent Swarm splits it
into independent units and runs specialists on them at the same time.

## When it helps

- The task has **genuinely separate parts** — different subjects, sources,
  sections, or files.
- You want **several lenses on the same thing** — draft it, check it, tighten
  it, and think about how it is presented.
- Gathering can happen **while** something else is being produced.

## When it does not

A single small change is faster done directly. Every specialist is a separate
run, so a swarm on a one-line task costs more and returns later for no gain.
Match the number of agents to the number of real units.

## How it works

1. **Decompose** — split the request into units that do not depend on each other.
2. **Delegate** — hand each to a specialist with the `task` tool, briefing it
   properly: goal, context, constraints, what to return. It starts with none of
   this conversation.
3. **Parallelise** — send the independent units in one message, as several
   `task` calls at once.
4. **Iterate** — feed results into the next wave (produce → check → revise).
5. **Synthesise** — merge into one answer, resolving disagreements between
   specialists rather than pasting both.

## Specialists

| Agent | Use for |
|---|---|
| `researcher` | Finding things out: sources, options, prior art |
| `analyst` | Data: inspecting, computing, concluding |
| `writer` | Long-form prose: drafting and editing |
| `reviewer` | Correctness, gaps, unstated assumptions |
| `optimizer` | Smaller, faster, cheaper, clearer |
| `uiux-designer` | How the result is presented and structured |
| `coder` | Writing and changing code, running tests |
| `explore` | Fast orientation in an unfamiliar codebase |
| `general` | Anything without a better fit |

Enter it by picking `swarm` from the agent list (Tab), or by asking for the
work to be split up.
