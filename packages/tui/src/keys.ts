/**
 * Keybindings.
 *
 * Two ways to reach an action: a direct chord (ctrl+p) or the leader key
 * (ctrl+x, then a letter). The leader exists because a terminal has very few
 * free chords — ctrl+c/d/z/w/u are all spoken for by the shell or the line
 * editor — and stealing more of them from the input box makes typing worse.
 */

export interface KeyEvent {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export type Action =
  | "palette"
  | "files"
  | "sessions"
  | "model"
  | "theme"
  | "interrupt"
  | "clear"
  | "compact"
  | "newline"
  | "submit"
  | "scroll-up"
  | "scroll-down"
  | "page-up"
  | "page-down"
  | "scroll-top"
  | "scroll-bottom"
  | "cancel"
  | "quit";

export const LEADER: KeyEvent = { name: "x", ctrl: true };

/** Direct chords, checked before the input box sees the key. */
const DIRECT: Array<[KeyEvent, Action]> = [
  [{ name: "p", ctrl: true }, "palette"],
  [{ name: "escape" }, "cancel"],
  [{ name: "pageup" }, "page-up"],
  [{ name: "pagedown" }, "page-down"],
];

/** Leader chords: ctrl+x then this key. */
const LEADER_MAP: Record<string, Action> = {
  p: "palette",
  f: "files",
  s: "sessions",
  m: "model",
  t: "theme",
  c: "clear",
  k: "compact",
  g: "scroll-top",
  G: "scroll-bottom",
  q: "quit",
};

export function isLeader(key: KeyEvent): boolean {
  return key.name === LEADER.name && !!key.ctrl;
}

export function matchDirect(key: KeyEvent): Action | null {
  for (const [chord, action] of DIRECT) {
    if (chord.name !== key.name) continue;
    if (!!chord.ctrl !== !!key.ctrl) continue;
    if (!!chord.shift !== !!key.shift) continue;
    return action;
  }
  return null;
}

export function matchLeader(key: KeyEvent): Action | null {
  if (key.ctrl || key.meta) return null;
  // Shift+g is a distinct binding from g, mirroring the vi convention.
  const name = key.shift && key.name.length === 1 ? key.name.toUpperCase() : key.name;
  return LEADER_MAP[name] ?? null;
}

/** Rows for the help screen and the command palette's hint column. */
export const KEY_HELP: Array<[string, string]> = [
  ["ctrl+p", "Command palette"],
  ["ctrl+x f", "Insert a file reference (@)"],
  ["ctrl+x s", "Sessions"],
  ["ctrl+x m", "Switch model"],
  ["ctrl+x t", "Switch theme"],
  ["ctrl+x k", "Compact context"],
  ["ctrl+x c", "Clear conversation"],
  ["ctrl+x g / G", "Jump to top / bottom"],
  ["@", "Reference a file"],
  ["!", "Run a shell command"],
  ["/", "Slash commands"],
  ["enter", "Send · shift+enter for a newline"],
  ["esc", "Interrupt, or close an overlay"],
  ["ctrl+c ×2", "Quit"],
];
