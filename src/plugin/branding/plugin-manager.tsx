import type { TuiPluginApi, TuiPluginStatus } from "@opencode-ai/plugin/tui";
import { registerMosaicCommands } from "./commands.tsx";

const BRANDING_PLUGIN_ID = "mosaic-branding";
const HOST_MANAGER_PLUGIN_ID = "internal:plugin-manager";
const HIDDEN_PLUGIN_IDS = new Set([BRANDING_PLUGIN_ID, HOST_MANAGER_PLUGIN_ID]);

export function visiblePluginStatuses<const Status extends { readonly id: string }>(
  statuses: readonly Status[],
): Status[] {
  return statuses.filter((status) => !HIDDEN_PLUGIN_IDS.has(status.id));
}

function statusLabel(status: TuiPluginStatus): string {
  if (!status.enabled) return "disabled";
  return status.active ? "active" : "inactive";
}

function showPlugins(api: TuiPluginApi): void {
  const statuses = visiblePluginStatuses(api.plugins.list());
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Plugins"
      options={statuses.map((status) => ({
        title: status.id,
        value: status.id,
        category: status.source === "internal" ? "Internal" : "External",
        description: status.source === "internal" ? "Built-in plugin" : status.spec,
        footer: statusLabel(status),
      }))}
      onSelect={(option) => {
        const status = statuses.find((candidate) => candidate.id === option.value);
        if (!status) return;
        const update = status.active
          ? api.plugins.deactivate(status.id)
          : api.plugins.activate(status.id);
        void update.then((ok) => {
          if (!ok) {
            api.ui.toast({
              variant: "error",
              message: `Failed to update plugin ${status.id}`,
            });
          }
          showPlugins(api);
        });
      }}
    />
  ));
}

function showInstallScope(api: TuiPluginApi): void {
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Install plugin"
      options={[
        { title: "Local", value: false, description: "Install for this project" },
        { title: "Global", value: true, description: "Install for every project" },
      ]}
      onSelect={(option) => showInstallPrompt(api, option.value)}
    />
  ));
}

function showInstallPrompt(api: TuiPluginApi, global: boolean): void {
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={`Install plugin (${global ? "global" : "local"})`}
      placeholder="npm package name"
      onConfirm={(raw) => {
        const spec = raw.trim();
        if (!spec) {
          api.ui.toast({ variant: "error", message: "Plugin package name is required" });
          return;
        }
        api.ui.dialog.clear();
        api.ui.toast({ variant: "info", message: `Installing ${spec}...` });
        void installPlugin(api, spec, global);
      }}
    />
  ));
}

async function installPlugin(api: TuiPluginApi, spec: string, global: boolean): Promise<void> {
  const result = await api.plugins.install(spec, { global });
  if (!result.ok) {
    api.ui.toast({ variant: "error", message: result.message });
    return;
  }

  api.ui.toast({
    variant: "success",
    message: `Installed ${spec} (${global ? "global" : "local"}: ${result.dir})`,
  });
  if (!result.tui) {
    api.ui.toast({ variant: "info", message: "Package has no TUI target to load in this app." });
    return;
  }

  const loaded = await api.plugins.add(spec);
  api.ui.toast(
    loaded
      ? { variant: "success", message: `Loaded ${spec} in current session.` }
      : {
          variant: "warning",
          message: "Installed plugin, but runtime load failed. Restart Mosaic to retry.",
        },
  );
}

export async function registerPluginManager(api: TuiPluginApi): Promise<void> {
  await api.plugins.deactivate(HOST_MANAGER_PLUGIN_ID).catch(() => false);
  registerMosaicCommands(api);
  api.keymap.registerLayer({
    commands: [
      {
        name: "plugins.list",
        title: "Plugins",
        category: "System",
        namespace: "palette",
        run: () => showPlugins(api),
      },
      {
        name: "plugins.install",
        title: "Install plugin",
        category: "System",
        namespace: "palette",
        run: () => showInstallScope(api),
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("plugins.palette", ["plugins.list", "plugins.install"]),
  });
}
