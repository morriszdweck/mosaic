import { SyntaxStyle } from "@opentui/core";

/**
 * Themes. A theme is a flat palette; every component reads colours from the
 * active one rather than hard-coding hexes, so `/theme` can switch the whole
 * UI at runtime and a new theme is one entry in THEMES.
 */

export interface Palette {
  /** Body text. */
  fg: string;
  /** De-emphasised text: hints, metadata, timestamps. */
  muted: string;
  /** Borders and rules. */
  border: string;
  /** Border/accent for the focused element. */
  borderActive: string;
  /** Selected row in an overlay. */
  selection: string;
  accent: string;
  /** The user's own messages. */
  user: string;
  success: string;
  warning: string;
  error: string;
  /** Syntax colours for markdown and code. */
  syntax: {
    heading: string;
    code: string;
    link: string;
    list: string;
    keyword: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    type: string;
    operator: string;
  };
}

export const THEMES: Record<string, Palette> = {
  tokyonight: {
    fg: "#c0caf5",
    muted: "#565f89",
    border: "#3b4261",
    borderActive: "#7aa2f7",
    selection: "#283457",
    accent: "#bb9af7",
    user: "#7aa2f7",
    success: "#9ece6a",
    warning: "#e0af68",
    error: "#f7768e",
    syntax: {
      heading: "#7aa2f7",
      code: "#9ece6a",
      link: "#73daca",
      list: "#e0af68",
      keyword: "#bb9af7",
      string: "#9ece6a",
      number: "#ff9e64",
      comment: "#565f89",
      function: "#7aa2f7",
      type: "#2ac3de",
      operator: "#89ddff",
    },
  },
  catppuccin: {
    fg: "#cdd6f4",
    muted: "#6c7086",
    border: "#45475a",
    borderActive: "#89b4fa",
    selection: "#313244",
    accent: "#cba6f7",
    user: "#89b4fa",
    success: "#a6e3a1",
    warning: "#f9e2af",
    error: "#f38ba8",
    syntax: {
      heading: "#89b4fa",
      code: "#a6e3a1",
      link: "#94e2d5",
      list: "#f9e2af",
      keyword: "#cba6f7",
      string: "#a6e3a1",
      number: "#fab387",
      comment: "#6c7086",
      function: "#89b4fa",
      type: "#94e2d5",
      operator: "#89dceb",
    },
  },
  gruvbox: {
    fg: "#ebdbb2",
    muted: "#928374",
    border: "#504945",
    borderActive: "#83a598",
    selection: "#3c3836",
    accent: "#d3869b",
    user: "#83a598",
    success: "#b8bb26",
    warning: "#fabd2f",
    error: "#fb4934",
    syntax: {
      heading: "#83a598",
      code: "#b8bb26",
      link: "#8ec07c",
      list: "#fabd2f",
      keyword: "#d3869b",
      string: "#b8bb26",
      number: "#fe8019",
      comment: "#928374",
      function: "#83a598",
      type: "#8ec07c",
      operator: "#fe8019",
    },
  },
  nord: {
    fg: "#d8dee9",
    muted: "#4c566a",
    border: "#434c5e",
    borderActive: "#88c0d0",
    selection: "#3b4252",
    accent: "#b48ead",
    user: "#88c0d0",
    success: "#a3be8c",
    warning: "#ebcb8b",
    error: "#bf616a",
    syntax: {
      heading: "#88c0d0",
      code: "#a3be8c",
      link: "#8fbcbb",
      list: "#ebcb8b",
      keyword: "#b48ead",
      string: "#a3be8c",
      number: "#d08770",
      comment: "#4c566a",
      function: "#88c0d0",
      type: "#8fbcbb",
      operator: "#81a1c1",
    },
  },
};

export const DEFAULT_THEME = "tokyonight";

let active: Palette = THEMES[DEFAULT_THEME]!;
let activeName = DEFAULT_THEME;
let cachedStyle: SyntaxStyle | null = null;

export function theme(): Palette {
  return active;
}

export function themeName(): string {
  return activeName;
}

export function setTheme(name: string): boolean {
  const next = THEMES[name];
  if (!next) return false;
  active = next;
  activeName = name;
  cachedStyle = null; // rebuilt on next render against the new palette
  return true;
}

/** Syntax theme for markdown and fenced code, derived from the active palette. */
export function markdownSyntaxStyle(): SyntaxStyle {
  if (!cachedStyle) {
    const s = active.syntax;
    cachedStyle = SyntaxStyle.fromStyles({
      "markup.heading": { fg: s.heading, bold: true },
      "markup.bold": { bold: true },
      "markup.italic": { italic: true },
      "markup.raw": { fg: s.code },
      "markup.link": { fg: s.link, underline: true },
      "markup.list": { fg: s.list },
      keyword: { fg: s.keyword },
      string: { fg: s.string },
      number: { fg: s.number },
      comment: { fg: s.comment, italic: true },
      function: { fg: s.function },
      type: { fg: s.type },
      operator: { fg: s.operator },
      default: { fg: active.fg },
    });
  }
  return cachedStyle;
}
