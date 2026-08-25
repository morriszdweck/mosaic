import { For, Show } from "solid-js";
import { theme } from "../theme.ts";

/**
 * The one overlay list used by every picker — command palette, `@` files,
 * `/model`, `/theme`, sessions. They differ only in their rows, so selection,
 * scrolling and highlighting live here once.
 */

export interface OverlayItem {
  /** Value handed back on select. */
  id: string;
  /** Primary text, fuzzy-matched. */
  label: string;
  /** Dimmed trailing text: descriptions, timestamps, model names. */
  detail?: string;
  /** Indices in `label` that matched the query. */
  positions?: number[];
}

const MAX_VISIBLE = 10;

export function Overlay(props: {
  title: string;
  items: OverlayItem[];
  selected: number;
  /** Shown when there are no items. */
  empty?: string;
  hint?: string;
}) {
  const t = () => theme();

  // Scroll the window so the cursor stays visible in a long list.
  const start = () => {
    const half = Math.floor(MAX_VISIBLE / 2);
    const max = Math.max(0, props.items.length - MAX_VISIBLE);
    return Math.max(0, Math.min(props.selected - half, max));
  };
  const visible = () => props.items.slice(start(), start() + MAX_VISIBLE);

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={t().borderActive}
      marginLeft={1}
      marginRight={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={t().accent}>{props.title}</text>
        <text fg={t().muted}>
          {props.items.length > 0 ? `${props.selected + 1}/${props.items.length}` : ""}
          {props.hint ? `  ${props.hint}` : ""}
        </text>
      </box>

      <Show when={props.items.length === 0}>
        <text fg={t().muted}>{props.empty ?? "No matches"}</text>
      </Show>

      <For each={visible()}>
        {(item, i) => {
          const index = () => start() + i();
          const isSelected = () => index() === props.selected;
          return (
            <box flexDirection="row" backgroundColor={isSelected() ? t().selection : undefined}>
              <text fg={isSelected() ? t().borderActive : t().muted}>{isSelected() ? "❯ " : "  "}</text>
              <Highlighted text={item.label} positions={item.positions} selected={isSelected()} />
              <Show when={item.detail}>
                <text fg={t().muted}>{"  " + item.detail}</text>
              </Show>
            </box>
          );
        }}
      </For>
    </box>
  );
}

/** Label with matched characters picked out, so you can see why a row ranked. */
function Highlighted(props: { text: string; positions?: number[]; selected: boolean }) {
  const t = () => theme();
  const base = () => (props.selected ? t().fg : t().muted);
  const marks = () => new Set(props.positions ?? []);

  return (
    <Show when={marks().size > 0} fallback={<text fg={base()}>{props.text}</text>}>
      <box flexDirection="row">
        <For each={[...props.text]}>
          {(ch, i) =>
            marks().has(i()) ? (
              <text fg={t().accent}>
                <b>{ch}</b>
              </text>
            ) : (
              <text fg={base()}>{ch}</text>
            )
          }
        </For>
      </box>
    </Show>
  );
}
