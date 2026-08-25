import { Show } from "solid-js";
import { markdownSyntaxStyle, theme } from "../theme.ts";
import type { AssistantEntry, ChatEntry, ToolEntry } from "../state.ts";

/** One chat entry rendered for the scroll area. Markdown for assistant text, panels for tools. */
export function MessageView(props: { entry: ChatEntry }) {
  const entry = () => props.entry;
  const t = () => theme();

  return (
    <box flexDirection="column" marginBottom={1}>
      {entry().kind === "user" && (
        <box flexDirection="row">
          <text fg={t().user}>
            <b>❯ </b>
          </text>
          <text fg={t().fg}>{(entry() as { text: string }).text}</text>
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

      {entry().kind === "system" && <text fg={t().muted}>{(entry() as { text: string }).text}</text>}

      {entry().kind === "error" && <text fg={t().error}>✗ {(entry() as { text: string }).text}</text>}
    </box>
  );
}

function ToolPanel(props: { entry: ToolEntry }) {
  const entry = () => props.entry;
  const t = () => theme();

  const status = () => {
    const e = entry();
    if (e.running) return { icon: "◌", color: t().warning };
    if (e.isError) return { icon: "✗", color: t().error };
    return { icon: "✓", color: t().success };
  };

  const isDiff = () => entry().name === "edit" || entry().name === "write";
  const body = () => truncateLines(entry().result, entry().isError ? 20 : 12);

  return (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={entry().isError ? t().error : t().border}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <text fg={status().color}>
          {status().icon} {entry().name}{" "}
        </text>
        <text fg={t().muted}>{summarizeArgs(entry().name, entry().arguments)}</text>
      </box>

      <Show when={!entry().collapsed && entry().result !== ""}>
        {isDiff() ? <Diff text={body()} /> : <text fg={t().fg}>{body()}</text>}
      </Show>
    </box>
  );
}

/** Colour +/- lines so edits read like a diff instead of a wall of text. */
function Diff(props: { text: string }) {
  const t = () => theme();
  const lines = () => props.text.split("\n");
  return (
    <box flexDirection="column">
      {lines().map((line) => (
        <text fg={line.startsWith("+") ? t().success : line.startsWith("-") ? t().error : t().muted}>{line}</text>
      ))}
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
