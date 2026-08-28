import type { Session } from "@opencode-ai/sdk/v2";
import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { formatAge } from "./memory-control.tsx";

export function runOptions(
  sessions: readonly Session[],
  currentSessionID?: string,
  now: number = Date.now(),
): Array<TuiDialogSelectOption<string>> {
  return [...sessions]
    .sort((a, b) => b.time.updated - a.time.updated || b.time.created - a.time.created)
    .map((session) => ({
      title: session.title.trim() || "Untitled run",
      value: session.id,
      category: session.id === currentSessionID ? "Current session" : session.parentID ? "Child run" : "Session",
      description: session.directory,
      footer: `${formatAge(session.time.updated, now)} · ${session.id}`,
    }));
}

export async function showRunsControlCenter(api: TuiPluginApi): Promise<void> {
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert title="Runs" message="Loading previous sessions in this directory…" />
  ));

  try {
    const response = await api.client.session.list(
      { directory: api.state.path.directory },
      { throwOnError: true },
    );
    showRunList(api, response.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert title="Runs" message={`Unable to load previous sessions: ${message}`} />
    ));
  }
}

function showRunList(api: TuiPluginApi, sessions: readonly Session[]): void {
  if (sessions.length === 0) {
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert
        title="Runs"
        message={`No previous sessions in ${api.state.path.directory}.`}
      />
    ));
    return;
  }

  const currentSessionID = getCurrentSessionID(api);
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<string>
      title={`Runs · ${sessions.length}`}
      placeholder="Filter runs"
      options={runOptions(sessions, currentSessionID)}
      onSelect={(option) => {
        if (!sessions.some((session) => session.id === option.value)) return;
        api.ui.dialog.clear();
        api.route.navigate("session", { sessionID: option.value });
      }}
    />
  ));
}

function getCurrentSessionID(api: TuiPluginApi): string | undefined {
  const current = api.route.current;
  if (current.name !== "session") return undefined;
  const sessionID = current.params?.sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}
