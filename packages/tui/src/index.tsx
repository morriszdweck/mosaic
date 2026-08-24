import { render } from "@opentui/solid";
import { App, type TuiOptions } from "./App.tsx";

/** Launch the Mosaic TUI. Returns the process exit code when the UI closes. */
export async function startTui(options: TuiOptions): Promise<number> {
  await render(() => <App {...options} />, {
    screenMode: "alternate-screen", // don't trash the user's scrollback
    exitOnCtrlC: false, // we handle Ctrl+C ourselves (double-tap to quit)
  });
  return 0;
}

export type { TuiOptions };
