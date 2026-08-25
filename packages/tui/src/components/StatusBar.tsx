import { theme } from "../theme.ts";

/** Status bar: model, context usage, session cost, tokens in/out. */
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
  const t = () => theme();
  const pct = () => Math.min(100, Math.round((props.contextTokens / props.contextWindow) * 100));
  const ctxColor = () => (pct() >= 90 ? t().error : pct() >= 70 ? t().warning : t().success);
  const cached = () => (props.cacheReadTokens > 0 ? ` ⛁${formatTokens(props.cacheReadTokens)}` : "");

  return (
    <box flexDirection="row" justifyContent="space-between" width="100%" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row">
        <text fg={props.running ? t().warning : t().muted}>{props.running ? "● running " : "○ idle "}</text>
        <text fg={t().accent}>{props.model}</text>
      </box>
      <box flexDirection="row">
        <text fg={ctxColor()}>{bar(pct())} </text>
        <text fg={ctxColor()}>{pct()}% </text>
        <text fg={t().muted}>
          ↑{formatTokens(props.inputTokens)} ↓{formatTokens(props.outputTokens)}
          {cached()}
        </text>
        <text fg={t().success}> ${props.cost.toFixed(4)}</text>
      </box>
    </box>
  );
}

/** Context usage as a short meter — easier to read at a glance than a number. */
function bar(pct: number): string {
  const width = 8;
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
