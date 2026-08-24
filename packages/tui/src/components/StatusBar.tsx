/** Status bar: model, context usage %, session cost, tokens in/out. */
export function StatusBar(props: {
  model: string;
  contextTokens: number;
  contextWindow: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
  running: boolean;
}) {
  const pct = () => Math.min(100, Math.round((props.contextTokens / props.contextWindow) * 100));
  const ctxColor = () => (pct() >= 90 ? "#f7768e" : pct() >= 70 ? "#e0af68" : "#9ece6a");
  const cached = () => (props.cacheReadTokens > 0 ? ` ⛁${formatTokens(props.cacheReadTokens)}` : "");

  return (
    <box flexDirection="row" justifyContent="space-between" width="100%">
      <box flexDirection="row">
        <text fg="#7aa2f7">{props.running ? "● running " : "○ idle "}</text>
        <text fg="#bb9af7">{props.model}</text>
      </box>
      <box flexDirection="row">
        <text fg={ctxColor()}>ctx {pct()}% </text>
        <text fg="#565f89">↑{formatTokens(props.inputTokens)} ↓{formatTokens(props.outputTokens)}{cached()}</text>
        <text fg="#9ece6a"> ${props.cost.toFixed(4)}</text>
      </box>
    </box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
