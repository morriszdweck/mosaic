import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { showMemoryControlCenter } from "./memory-control.tsx";
import { showRunsControlCenter } from "./runs-control.tsx";

export const MOSAIC_COMMANDS = [
  {
    name: "memory",
    title: "Memory control center",
    value: "mosaic.memory",
    description: "Browse and forget remembered context",
    category: "Mosaic",
  },
  {
    name: "runs",
    title: "Runs",
    value: "mosaic.runs",
    description: "Browse previous sessions and scheduled runs",
    category: "Mosaic",
  },
] as const;

type MosaicCommandName = (typeof MOSAIC_COMMANDS)[number]["name"];
type MosaicCommandOpener = (api: TuiPluginApi) => void | Promise<void>;

const OPENERS: Record<MosaicCommandName, MosaicCommandOpener> = {
  memory: showMemoryControlCenter,
  runs: showRunsControlCenter,
};

export function registerMosaicCommands(api: TuiPluginApi): void {
  const unregister = api.keymap.registerLayer({
    commands: MOSAIC_COMMANDS.map((command) => ({
      name: command.value,
      title: command.title,
      desc: command.description,
      category: command.category,
      namespace: "palette",
      slashName: command.name,
      run: () => OPENERS[command.name](api),
    })),
    bindings: [],
  });
  api.lifecycle.onDispose(unregister);
}
