import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

/**
 * Mosaic's TUI branding.
 *
 * The engine's home screen carries its own wordmark and coding-flavoured
 * example prompts. Both are exposed as plugin slots, so Mosaic replaces them
 * here rather than by vendoring the TUI — the whole point of depending on the
 * engine instead of forking it.
 */

/** Block-capital wordmark, drawn in the same style the host uses. */
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
 * `home-footer` renders "• OpenCode <version>" and `home-tips` advertises
 * connecting a provider "to start coding". Neither is reachable through a slot
 * — the host registers them append-only, so anything Mosaic adds lands beside
 * them rather than instead of them. Deactivating them is the supported way to
 * take the space over.
 */
const REPLACED_PLUGINS = ["internal:home-footer", "internal:home-tips"];

/** Shown under the prompt, in place of the engine's coding-flavoured tips. */
const TIPS = [
  "Tab switches agents — swarm splits a task across specialists",
  "@ pulls a file into the conversation",
  "Ask me to keep checking something and I'll start a heartbeat",
  "/theme to switch between mosaic and mosaic-dark",
  "Tell me how you like things and I'll remember it",
  "! runs a shell command inline",
];

const tui: TuiPlugin = async (api) => {
  for (const id of REPLACED_PLUGINS) {
    // Best-effort: an id that no longer exists upstream should not stop the
    // rest of Mosaic's branding from loading.
    await api.plugins.deactivate(id).catch(() => false);
  }

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

const plugin: TuiPluginModule = { id: "mosaic-branding", tui };

export default plugin;
export { PLACEHOLDERS, TIPS, WORDMARK };
