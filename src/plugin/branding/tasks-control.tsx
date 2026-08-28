import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { describeWhen, TaskStore, type Task } from "../schedule/store.ts";
import { editTask, runTaskNow } from "./tasks-actions.tsx";

type TaskAction = "details" | "run" | "toggle" | "edit" | "cancel" | "back";

export function taskOptions(
  tasks: readonly Task[],
  now: number = Date.now(),
): Array<TuiDialogSelectOption<number>> {
  return [...tasks]
    .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt || a.id - b.id)
    .map((task) => ({
      title: taskTitle(task.prompt),
      value: task.id,
      category: taskCategory(task),
      description: [task.paused ? "Paused" : "Active", task.scope === "standalone" ? task.directory : "This conversation"].join(
        " · ",
      ),
      footer: [
        describeWhen(task, now),
        task.lastStatus ? `last ${task.lastStatus}` : "not run",
        `#${task.id}`,
      ].join(" · "),
    }));
}

export function showTasksControlCenter(api: TuiPluginApi): void {
  let tasks: Task[];
  try {
    tasks = readTasks(api);
  } catch (error) {
    showTaskError(api, error);
    return;
  }

  api.ui.dialog.setSize("large");
  if (tasks.length === 0) {
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert
        title="Tasks"
        message="Nothing is scheduled here. Ask Mosaic to create a task or heartbeat."
      />
    ));
    return;
  }

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<number>
      title={`Tasks · ${tasks.length}`}
      placeholder="Filter tasks"
      options={taskOptions(tasks)}
      onSelect={(option) => {
        const task = tasks.find((candidate) => candidate.id === option.value);
        if (task) showTaskActions(api, task);
      }}
    />
  ));
}

function readTasks(api: TuiPluginApi): Task[] {
  const store = new TaskStore();
  try {
    const sessionID = getCurrentSessionID(api);
    const conversation = sessionID ? store.list(sessionID) : [];
    const standing = store.listStandalone(api.state.path.directory);
    return [...conversation, ...standing];
  } finally {
    store.close();
  }
}

function showTaskDetails(api: TuiPluginApi, task: Task): void {
  const lastRun = task.lastStatus
    ? [
        `Last run: ${task.lastStatus}${task.lastRunAt ? ` · ${new Date(task.lastRunAt).toLocaleString()}` : ""}`,
        task.lastOutput ? `\n${clip(task.lastOutput, 1200)}` : "",
      ].join("")
    : "No run recorded yet.";
  const location = task.scope === "standalone" ? `Standing task · ${task.directory}` : "This conversation";
  const message = [
    task.prompt,
    "",
    location,
    `Schedule: ${task.when}`,
    `Next: ${describeWhen(task)}`,
    `Fired: ${task.fired} time${task.fired === 1 ? "" : "s"}`,
    `Status: ${task.paused ? "paused" : "active"}`,
    lastRun,
    "",
    "Press enter to close.",
  ].join("\n");

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert
      title={`Task #${task.id} · ${taskCategory(task)}`}
      message={message}
    />
  ));
}

function showTaskActions(api: TuiPluginApi, task: Task): void {
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<TaskAction>
      title={`Task #${task.id} actions`}
      options={[
        { title: "View details", value: "details", description: "See the prompt, schedule, and last result" },
        {
          title: "Run now",
          value: "run",
          description: "Run once immediately without changing the next scheduled time",
        },
        {
          title: task.paused ? "Resume" : "Pause",
          value: "toggle",
          description: task.paused ? "Turn the schedule back on" : "Keep the task visible but stop it firing",
        },
        {
          title: "Edit prompt and schedule",
          value: "edit",
          description: "Change what runs or when it runs next",
        },
        { title: "Cancel task", value: "cancel", description: "Remove this pending task" },
        { title: "Back", value: "back", description: "Return to the task list" },
      ]}
      onSelect={(option) => {
        switch (option.value) {
          case "details":
            showTaskDetails(api, task);
            return;
          case "run":
            void runTaskNow(api, task, () => showTasksControlCenter(api));
            return;
          case "toggle":
            toggleTask(api, task);
            return;
          case "edit":
            editTask(api, task, () => showTasksControlCenter(api));
            return;
          case "cancel":
            showCancelConfirmation(api, task);
            return;
          case "back":
            showTasksControlCenter(api);
            return;
          default:
            return assertNever(option.value);
        }
      }}
    />
  ));
}

function showCancelConfirmation(api: TuiPluginApi, task: Task): void {
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title={`Cancel task #${task.id}?`}
      message={taskTitle(task.prompt)}
      onConfirm={() => cancelTask(api, task.id)}
      onCancel={() => showTaskActions(api, task)}
    />
  ));
}

function cancelTask(api: TuiPluginApi, id: number): void {
  try {
    const store = new TaskStore();
    let cancelled: boolean;
    try {
      cancelled = store.cancel(id);
    } finally {
      store.close();
    }

    api.ui.toast(
      cancelled
        ? { variant: "success", message: `Cancelled task #${id}` }
        : { variant: "warning", message: `Task #${id} was already gone` },
    );
    showTasksControlCenter(api);
  } catch (error) {
    showTaskError(api, error);
  }
}

function toggleTask(api: TuiPluginApi, task: Task): void {
  try {
    const store = new TaskStore();
    let changed: boolean;
    try {
      changed = store.setPaused(task.id, !task.paused);
    } finally {
      store.close();
    }

    api.ui.toast(
      changed
        ? { variant: "success", message: `${task.paused ? "Resumed" : "Paused"} task #${task.id}` }
        : { variant: "warning", message: `Task #${task.id} was already gone` },
    );
    showTasksControlCenter(api);
  } catch (error) {
    showTaskError(api, error);
  }
}

function showTaskError(api: TuiPluginApi, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => <api.ui.DialogAlert title="Tasks" message={`Unable to open tasks: ${message}`} />);
}

function getCurrentSessionID(api: TuiPluginApi): string | undefined {
  const current = api.route.current;
  if (current.name !== "session") return undefined;
  const sessionID = current.params?.sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}

function taskCategory(task: Task): string {
  if (task.heartbeat) return "Heartbeat";
  return task.scope === "standalone" ? "Standing task" : "This conversation";
}

function taskTitle(prompt: string): string {
  return clip(prompt.split("\n")[0]?.trim() ?? "", 100) || "Untitled task";
}

function clip(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected task action: ${String(value)}`);
}
