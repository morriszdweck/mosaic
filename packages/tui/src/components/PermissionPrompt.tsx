import type { PermissionDecision } from "@mosaic/core";

/**
 * Permission prompt: allow once / always / deny.
 * Rendered as an inline panel; keys: y = once, a = always, n = deny.
 */
export function PermissionPrompt(props: {
  tool: string;
  detail: string;
  onDecision: (decision: PermissionDecision) => void;
}) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="#e0af68"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <text fg="#e0af68">
        <b>Permission required</b>
      </text>
      <text fg="#c0caf5">{props.detail}</text>
      <text fg="#565f89">[y] allow once   [a] always allow {props.tool}   [n] deny</text>
    </box>
  );
}
