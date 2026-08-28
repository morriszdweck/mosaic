import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { registerPluginManager } from "./plugin-manager.tsx";

export { MOSAIC_COMMANDS } from "./commands.tsx";
export { visiblePluginStatuses } from "./plugin-manager.tsx";

/**
 * Built-in Mosaic TUI branding.
 *
 * The engine's home screen carries its own wordmark and coding-flavoured
 * example prompts. Both are exposed as plugin slots, so Mosaic replaces them
 * here rather than by vendoring the TUI — the whole point of depending on the
 * engine instead of forking it. This module ships inside Mosaic and is
 * force-loaded by the launcher; it is not an installable or removable user
 * plugin.
 */

/** Product name rendered by the home-screen splash. */
const SPLASH_TEXT = "mosaic";

/** Large block-capital treatment for the splash text. */
const WORDMARK = [
  "█▀▄▀█ █▀▀█ █▀▀▀ █▀▀█ ▀█▀ █▀▀█",
  "█ █ █ █  █ ▀▀▀█ █▄▄█  █  █   ",
  "▀   ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀ ▀▀▀▀",
];

/**
 * Example prompts. Deliberately spread across research, writing, analysis and
 * system work — the home screen is where a user forms their idea of what the
 * tool is for, and the engine's defaults all say "coding tool".
 */
const PLACEHOLDERS = [
  "Summarise these three papers and tell me where they disagree",
  "What changed in this directory last week?",
  "Draft a reply to this email",
  "Find every config that still points at the old host",
  "Explain what this CSV is actually measuring",
  "Plan the migration and list what could go wrong",
  "Fix the failing test",
];

/**
 * Built-in interface plugins Mosaic replaces.
 *
 * `home-footer` and `sidebar-footer` each render "• OpenCode <version>", and
 * `home-tips` advertises connecting a provider "to start coding". None is
 * reachable through a slot — the host registers them append-only, so anything
 * Mosaic adds lands beside them rather than instead of them. Deactivating them
 * is the supported way to take the space over.
 *
 * There are two footers because the sidebar has its own, and it is the one
 * still visible once a session is open.
 */
const REPLACED_PLUGINS = ["internal:home-footer", "internal:home-tips", "internal:sidebar-footer"];

/** Shown under the prompt, in place of the engine's coding-flavoured tips. */
const TIPS = [
  "Tab switches agents — swarm splits a task across specialists",
  "@ pulls a file into the conversation",
  "Ask me to keep checking something and I'll start a heartbeat",
  "\"Every weekday at 8, brief me\" — standing tasks run with Mosaic closed",
  "/theme to switch between mosaic-light and mosaic-dark",
  "Tell me how you like things and I'll remember it",
  "! runs a shell command inline",
];

const tui: TuiPlugin = async (api) => {
  for (const id of REPLACED_PLUGINS) {
    // Best-effort: an id that no longer exists upstream should not stop the
    // rest of Mosaic's branding from loading.
    await api.plugins.deactivate(id).catch(() => false);
  }
  await registerPluginManager(api);

  const version = process.env.MOSAIC_VERSION ?? "";
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)]!;

  api.slots.register({
    // Above the host's own logo registration so ours is the one that renders.
    order: 1000,
    slots: {
      home_logo() {
        return (
          <box flexDirection="column">
            {WORDMARK.map((line) => (
              <text fg={api.theme.current.primary}>{line}</text>
            ))}
            <text fg={api.theme.current.textMuted}>think in pieces. act as one.</text>
          </box>
        );
      },

      // Taking over from internal:home-footer, deactivated above.
      home_footer() {
        return (
          <box flexDirection="row" flexGrow={1}>
            <text fg={api.theme.current.textMuted}>{cwdLabel()}</text>
            <box flexGrow={1} />
            <text fg={api.theme.current.primary}>◆ </text>
            <text fg={api.theme.current.textMuted}>{version ? `Mosaic ${version}` : "Mosaic"}</text>
          </box>
        );
      },

      // Taking over from internal:sidebar-footer, which renders the same
      // engine version down the right-hand side of an open session.
      sidebar_footer() {
        return (
          <box flexDirection="row">
            <text fg={api.theme.current.primary}>◆ </text>
            <text fg={api.theme.current.textMuted}>{version ? `Mosaic ${version}` : "Mosaic"}</text>
          </box>
        );
      },

      // Taking over from internal:home-tips.
      home_bottom() {
        return (
          <box flexDirection="row">
            <text fg={api.theme.current.primary}>◆ </text>
            <text fg={api.theme.current.textMuted}>{tip}</text>
          </box>
        );
      },

      // A replace-mode slot: the host's prompt is not rendered alongside this
      // one, so the ref and the right-hand slot have to be passed through or
      // the home screen loses input focus and its status indicators.
      home_prompt(_ctx, props) {
        return (
          <api.ui.Prompt
            ref={props.ref}
            right={<api.ui.Slot name="home_prompt_right" />}
            placeholders={{ normal: PLACEHOLDERS }}
          />
        );
      },
    },
  });
};

/** Working directory, shortened against $HOME the way a shell prompt would. */
function cwdLabel(): string {
  const cwd = process.cwd();
  const home = process.env.HOME ?? "";
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

const builtinBranding: TuiPluginModule = { id: "mosaic-branding", tui };

export default builtinBranding;
export { PLACEHOLDERS, SPLASH_TEXT, TIPS, WORDMARK };
