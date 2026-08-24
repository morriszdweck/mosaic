import { markdownSyntaxStyle } from "../theme.ts";
import type { AssistantEntry, ChatEntry, ToolEntry } from "../state.ts";

/** One chat entry rendered for the scroll area. Markdown for assistant text, panels for tools. */
export function MessageView(props: { entry: ChatEntry }) {
  const entry = () => props.entry;

  return (
    <box flexDirection="column" marginBottom={1}>
      {entry().kind === "user" && (
        <box flexDirection="row">
          <text fg="#7aa2f7"><b>❯ </b></text>
          <text fg="#c0caf5">{(entry() as { text: string }).text}</text>
        </box>
      )}

      {entry().kind === "assistant" && (
        <box flexDirection="column">
          <markdown
            content={(entry() as AssistantEntry).text || ((entry() as AssistantEntry).streaming ? "…" : "")}
            syntaxStyle={markdownSyntaxStyle()}
          />
        </box>
      )}

      {entry().kind === "tool" && <ToolPanel entry={entry() as ToolEntry} />}

      {entry().kind === "system" && <text fg="#565f89">{(entry() as { text: string }).text}</text>}

      {entry().kind === "error" && <text fg="#f7768e">✗ {(entry() as { text: string }).text}</text>}
    </box>
  );
}

function ToolPanel(props: { entry: ToolEntry }) {
  const entry = () => props.entry;
  const status = () => {
    const e = entry();
    if (e.running) return { icon: "◌", color: "#e0af68" };
    if (e.isError) return { icon: "✗", color: "#f7768e" };
    return { icon: "✓", color: "#9ece6a" };
  };

  return (
    <box flexDirection="column" border borderStyle="single" borderColor="#3b4261" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row">
        <text fg={status().color}>{status().icon} {entry().name} </text>
        <text fg="#565f89">{summarizeArgs(entry().name, entry().arguments)}</text>
      </box>
      {!entry().collapsed && entry().result !== "" && (
        <text fg="#a9b1d6">{truncateLines(entry().result, 12)}</text>
      )}
    </box>
  );
}

function summarizeArgs(name: string, raw: string): string {
  try {
    const args = JSON.parse(raw || "{}") as Record<string, unknown>;
    if (typeof args.command === "string") return args.command.slice(0, 60);
    if (typeof args.path === "string") return args.path;
    if (typeof args.pattern === "string") return `/${args.pattern}/`;
    if (typeof args.query === "string") return args.query.slice(0, 60);
    if (typeof args.url === "string") return args.url.slice(0, 60);
  } catch {
    // partial JSON while streaming
  }
  return "";
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`].join("\n");
}
