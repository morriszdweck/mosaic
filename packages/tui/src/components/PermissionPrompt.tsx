import { theme } from "../theme.ts";

/**
 * Permission prompt: allow once / always / deny.
 * Rendered as an inline panel; keys: y = once, a = always, n = deny.
 */
export function PermissionPrompt(props: { tool: string; detail: string }) {
  const t = () => theme();
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={t().warning}
      marginLeft={1}
      marginRight={1}
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <text fg={t().warning}>
        <b>Permission required — {props.tool}</b>
      </text>
      <text fg={t().fg}>{props.detail}</text>
      <text fg={t().muted}>[y] allow once   [a] always allow {props.tool}   [n] deny</text>
    </box>
  );
}
