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

const tui: TuiPlugin = async (api) => {
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

const plugin: TuiPluginModule = { id: "mosaic-branding", tui };

export default plugin;
export { PLACEHOLDERS, WORDMARK };
