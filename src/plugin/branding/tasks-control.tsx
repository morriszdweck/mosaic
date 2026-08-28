import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { describeWhen, TaskStore, type Task } from "../schedule/store.ts";

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
      description: task.scope === "standalone" ? task.directory : "This conversation",
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
        if (task) showTaskDetails(api, task);
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
    lastRun,
    "",
    "Cancel this task?",
  ].join("\n");

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title={`Task #${task.id} · ${taskCategory(task)}`}
      message={message}
      onConfirm={() => cancelTask(api, task.id)}
      onCancel={() => showTasksControlCenter(api)}
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
