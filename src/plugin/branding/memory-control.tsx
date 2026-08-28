import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { MemoryStore, type Memory } from "../memory/store.ts";

export function memoryOptions(
  memories: readonly Memory[],
  now: number = Date.now(),
): Array<TuiDialogSelectOption<number>> {
  return [...memories]
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    .map((memory) => ({
      title: memory.content,
      value: memory.id,
      category: memory.scope ? "This project" : "Everywhere",
      description: `${kindLabel(memory.kind)} memory`,
      footer: [
        `#${memory.id}`,
        formatAge(memory.createdAt, now),
        `${memory.useCount} recall${memory.useCount === 1 ? "" : "s"}`,
      ].join(" · "),
    }));
}

export function formatAge(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function showMemoryControlCenter(api: TuiPluginApi): void {
  let memories: Memory[];
  try {
    memories = readMemories(api.state.path.directory);
  } catch (error) {
    showMemoryError(api, error);
    return;
  }

  api.ui.dialog.setSize("large");
  if (memories.length === 0) {
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert
        title="Memory control center"
        message="No memories are stored yet. Mosaic will add memories when you ask it to remember something."
      />
    ));
    return;
  }

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<number>
      title={`Memory control center · ${memories.length}`}
      placeholder="Filter memories"
      options={memoryOptions(memories)}
      onSelect={(option) => {
        const memory = memories.find((candidate) => candidate.id === option.value);
        if (memory) showMemoryDetails(api, memory);
      }}
    />
  ));
}

function readMemories(scope: string): Memory[] {
  const store = new MemoryStore();
  try {
    return store.all(scope);
  } finally {
    store.close();
  }
}

function showMemoryDetails(api: TuiPluginApi, memory: Memory): void {
  const scope = memory.scope ? `This project · ${memory.scope}` : "Everywhere";
  const message = [
    memory.content,
    "",
    `${kindLabel(memory.kind)} memory · ${scope}`,
    `Saved ${formatAge(memory.createdAt)} · ${memory.useCount} recall${memory.useCount === 1 ? "" : "s"}`,
    "",
    "Forget this memory?",
  ].join("\n");

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title={`Memory #${memory.id}`}
      message={message}
      onConfirm={() => forgetMemory(api, memory.id)}
      onCancel={() => showMemoryControlCenter(api)}
    />
  ));
}

function forgetMemory(api: TuiPluginApi, id: number): void {
  try {
    const store = new MemoryStore();
    let forgotten: boolean;
    try {
      forgotten = store.forget(id);
    } finally {
      store.close();
    }

    api.ui.toast(
      forgotten
        ? { variant: "success", message: `Forgot memory #${id}` }
        : { variant: "warning", message: `Memory #${id} was already gone` },
    );
    showMemoryControlCenter(api);
  } catch (error) {
    showMemoryError(api, error);
  }
}

function showMemoryError(api: TuiPluginApi, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert title="Memory control center" message={`Unable to open memory: ${message}`} />
  ));
}

function kindLabel(kind: Memory["kind"]): string {
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}
