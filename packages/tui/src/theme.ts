import { SyntaxStyle } from "@opentui/core";

/** Shared syntax theme for markdown/code blocks (Tokyo Night-ish palette). */
let cached: SyntaxStyle | null = null;

export function markdownSyntaxStyle(): SyntaxStyle {
  if (!cached) {
    cached = SyntaxStyle.fromStyles({
      "markup.heading": { fg: "#7aa2f7", bold: true },
      "markup.bold": { bold: true },
      "markup.italic": { italic: true },
      "markup.raw": { fg: "#9ece6a" },
      "markup.link": { fg: "#73daca", underline: true },
      "markup.list": { fg: "#e0af68" },
      keyword: { fg: "#bb9af7" },
      string: { fg: "#9ece6a" },
      number: { fg: "#ff9e64" },
      comment: { fg: "#565f89", italic: true },
      function: { fg: "#7aa2f7" },
      type: { fg: "#2ac3de" },
      operator: { fg: "#89ddff" },
      default: { fg: "#c0caf5" },
    });
  }
  return cached;
}
