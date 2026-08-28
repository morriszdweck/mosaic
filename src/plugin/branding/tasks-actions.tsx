import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { runOneAsync } from "../schedule/runner.ts";
import { parseWhen, TaskStore, type Task } from "../schedule/store.ts";

export function editTask(api: TuiPluginApi, task: Task, refresh: () => void): void {
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={`Edit task #${task.id}`}
      value={task.prompt}
      placeholder="What should Mosaic do?"
      onConfirm={(raw) => {
        if (!raw.trim()) {
          api.ui.toast({ variant: "error", message: "A task needs a prompt" });
          return;
        }
        showScheduleEdit(api, task, raw.trim(), refresh);
      }}
      onCancel={refresh}
    />
  ));
}

function showScheduleEdit(api: TuiPluginApi, task: Task, prompt: string, refresh: () => void): void {
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={`Edit task #${task.id} schedule`}
      value={task.when}
      placeholder="in 10m, every day at 09:00, or every weekday at 08:30"
      onConfirm={(raw) => {
        const when = raw.trim();
        try {
          const parsed = parseWhen(when);
          const store = new TaskStore();
          let updated: boolean;
          try {
            updated = store.update({
              id: task.id,
              prompt,
              dueAt: parsed.dueAt,
              repeat: parsed.repeat,
              recurrence: parsed.recurrence ?? null,
              when,
            });
          } finally {
            store.close();
          }

          api.ui.toast(
            updated
              ? { variant: "success", message: `Updated task #${task.id}` }
              : { variant: "warning", message: `Task #${task.id} was already gone` },
          );
          refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          api.ui.toast({ variant: "error", message });
          showScheduleEdit(api, task, prompt, refresh);
        }
      }}
      onCancel={refresh}
    />
  ));
}

export async function runTaskNow(api: TuiPluginApi, task: Task, refresh: () => void): Promise<void> {
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert
      title={`Running task #${task.id}`}
      message="The task is running once now. Its next schedule is unchanged."
    />
  ));

  try {
    if (task.scope === "standalone") {
      const store = new TaskStore();
      try {
        const latest = store.get(task.id);
        if (!latest) throw new Error(`Task #${task.id} was already gone.`);
        const outcome = await runOneAsync(store, latest);
        api.ui.toast({
          variant: outcome.status === "ok" ? "success" : "error",
          message: `Task #${task.id} finished ${outcome.status}`,
        });
      } finally {
        store.close();
      }
    } else {
      await api.client.session.promptAsync({
        sessionID: task.sessionID,
        directory: api.state.path.directory,
        parts: [{ type: "text", text: task.prompt }],
      });
      recordTaskRun(task.id, "ok", "Prompt submitted from /tasks.");
      api.ui.toast({ variant: "success", message: `Task #${task.id} submitted` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.ui.toast({ variant: "error", message: `Task #${task.id} failed: ${message}` });
  }
  refresh();
}

function recordTaskRun(id: number, status: "ok" | "failed", output: string): void {
  const store = new TaskStore();
  try {
    store.recordRun(id, status, output);
  } finally {
    store.close();
  }
}
