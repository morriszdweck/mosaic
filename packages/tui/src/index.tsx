import { render } from "@opentui/solid";
import { App, type TuiOptions } from "./App.tsx";

/**
 * Restore the terminal no matter how the process ends (crash, signal, or our
 * own Ctrl+C exit): disable mouse reporting and re-show the cursor. Without
 * this, quitting can leave the shell receiving raw mouse events as text.
 */
const RESTORE_TERMINAL = "\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?25h";
let restoreRegistered = false;

function registerTerminalRestore(): void {
  if (restoreRegistered) return;
  restoreRegistered = true;
  process.on("exit", () => {
    try {
      process.stdout.write(RESTORE_TERMINAL);
    } catch {
      // stdout already gone — nothing more we can do
    }
  });
}

/** Launch the Mosaic TUI. Returns the process exit code when the UI closes. */
export async function startTui(options: TuiOptions): Promise<number> {
  registerTerminalRestore();
  // NOTE: opentui's render() resolves as soon as the UI is *mounted* — it does
  // not wait for the UI to close. If we returned then, the CLI would exit and
  // kill the TUI a split second after startup. Block until the renderer is
  // destroyed instead (onDestroy fires on renderer.destroy()).
  await new Promise<void>((resolve) => {
    render(() => <App {...options} />, {
      screenMode: "alternate-screen", // don't trash the user's scrollback
      exitOnCtrlC: false, // we handle Ctrl+C ourselves (double-tap to quit)
      onDestroy: () => resolve(),
    }).catch(() => resolve());
  });
  process.stdout.write(RESTORE_TERMINAL);
  return 0;
}

export type { TuiOptions };
