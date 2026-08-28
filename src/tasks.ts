/**
 * `mosaic tasks` — standalone scheduled tasks from the command line.
 *
 * Standalone tasks outlive the session that made them, so they need a way to be
 * seen and stopped that does not involve opening the conversation they came
 * from. `run-due` is also the entry point the OS scheduler calls; the rest is
 * for people.
 */

import { install, isInstalled, currentMethod, uninstall } from "./plugin/schedule/installer.ts";
import { logOutcomes, runDue, runOne } from "./plugin/schedule/runner.ts";
import { describeWhen, parseWhen, type Task, TaskStore } from "./plugin/schedule/store.ts";

const USAGE = `mosaic tasks — scheduled work that runs whether or not Mosaic is open

  mosaic tasks                     list standalone tasks
  mosaic tasks add <when> <prompt> schedule one
  mosaic tasks cancel <id>         stop one
  mosaic tasks run <id>            run one now, without waiting for its time
  mosaic tasks log [id]            what the last run produced
  mosaic tasks install             register with the OS scheduler
  mosaic tasks uninstall           unregister; nothing will fire
  mosaic tasks status              whether the OS scheduler knows about Mosaic

  when: "every day at 09:00", "every weekday at 08:30", "every monday at 17:00",
        "every 2h", "at 14:30", "in 10m"`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function ago(at: number | null): string {
  if (!at) return "never";
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function describeTask(task: Task): string {
  const last = task.lastRunAt ? `last run ${ago(task.lastRunAt)} (${task.lastStatus})` : "not yet run";
  const where = task.directory ? `\n     in ${task.directory}` : "";
  const state = task.paused ? "paused" : "active";
  return `[${task.id}] ${describeWhen(task)} (${state})\n     ${task.prompt.split("\n")[0]}\n     ${last}${where}`;
}

function list(store: TaskStore): void {
  const tasks = store.listStandalone();
  if (!tasks.length) {
    console.log('Nothing scheduled. Add one with: mosaic tasks add "every day at 09:00" "..."');
    return;
  }
  console.log(tasks.map(describeTask).join("\n"));
  if (!isInstalled()) {
    console.log(`\nWarning: the OS scheduler has no Mosaic entry, so none of these will fire.`);
    console.log("Run: mosaic tasks install");
  }
}

const store = new TaskStore();
const [command = "list", ...rest] = process.argv.slice(2);

switch (command) {
  case "list":
    list(store);
    break;

  case "add": {
    const when = rest[0];
    const prompt = rest.slice(1).join(" ");
    if (!when || !prompt) fail(`Usage: mosaic tasks add "every day at 09:00" "what to do"`);
    let parsed;
    try {
      parsed = parseWhen(when);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const task = store.add({
      scope: "standalone",
      directory: process.cwd(),
      prompt,
      when,
      dueAt: parsed.dueAt,
      repeat: parsed.repeat,
      recurrence: parsed.recurrence ?? null,
    });
    console.log(`Scheduled [${task.id}] ${describeWhen(task)}.`);
    if (!isInstalled()) {
      const result = install();
      console.log(result.message);
    }
    break;
  }

  case "cancel": {
    const id = Number(rest[0]);
    if (!Number.isFinite(id)) fail("Usage: mosaic tasks cancel <id>");
    console.log(store.cancel(id) ? `Cancelled [${id}].` : `No pending task [${id}].`);
    break;
  }

  case "run": {
    const id = Number(rest[0]);
    const task = Number.isFinite(id) ? store.get(id) : null;
    if (!task) fail("Usage: mosaic tasks run <id>");
    if (task.scope !== "standalone") fail(`[${id}] belongs to a conversation and only runs while that session is open.`);
    // Deliberately does not advance the schedule: trying tomorrow's briefing
    // out should not mean tomorrow stops getting one.
    const outcome = runOne(store, task);
    console.log(`[${id}] ${outcome.status}\n${outcome.detail}`);
    process.exit(outcome.status === "failed" ? 1 : 0);
    break;
  }

  case "log": {
    const id = Number(rest[0]);
    const task = Number.isFinite(id) ? store.get(id) : store.listStandalone().find((t) => t.lastRunAt);
    if (!task) fail("No run to show yet.");
    console.log(`[${task.id}] ${task.when} — last run ${ago(task.lastRunAt)} (${task.lastStatus ?? "never"})\n`);
    console.log(task.lastOutput ?? "(no output)");
    break;
  }

  case "run-due": {
    store.close();
    const outcomes = runDue();
    logOutcomes(outcomes);
    for (const outcome of outcomes) console.log(`[${outcome.task.id}] ${outcome.status}`);
    break;
  }

  case "install": {
    const result = install();
    console.log(result.message);
    process.exit(result.ok ? 0 : 1);
    break;
  }

  case "uninstall": {
    const result = uninstall();
    console.log(result.message);
    break;
  }

  case "status": {
    const pending = store.listStandalone().length;
    console.log(
      isInstalled()
        ? `Registered with ${currentMethod()}, checking every minute. ${pending} task(s) scheduled.`
        : `Not registered with the OS scheduler — nothing will fire. Run: mosaic tasks install`,
    );
    break;
  }

  case "--help":
  case "-h":
  case "help":
    console.log(USAGE);
    break;

  default:
    fail(`Unknown command "${command}".\n\n${USAGE}`);
}
