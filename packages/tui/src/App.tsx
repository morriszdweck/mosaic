import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import {
  compactDeterministic,
  createAgentRuntime,
  estimateContextTokens,
  keyEnvFor,
  PROVIDER_PRESETS,
  SessionStore,
  type AgentRuntime,
  type PermissionDecision,
} from "@mosaic/core";
import { MessageView } from "./components/MessageView.tsx";
import { Overlay, type OverlayItem } from "./components/Overlay.tsx";
import { PermissionPrompt } from "./components/PermissionPrompt.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { indexFiles, invalidateFileIndex, readReference } from "./files.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import { isLeader, KEY_HELP, matchDirect, matchLeader, type Action } from "./keys.ts";
import { setTheme, theme, themeName, THEMES } from "./theme.ts";
import { SLASH_COMMANDS, type ChatEntry } from "./state.ts";

export interface TuiOptions {
  cwd: string;
  model?: string;
  resume?: string;
  continueSession?: boolean;
}

interface PendingPermission {
  tool: string;
  detail: string;
  resolve: (decision: PermissionDecision) => void;
}

/** Which picker is open. Only one at a time — they all own the same keys. */
type OverlayKind = "palette" | "files" | "model" | "theme" | "sessions" | "slash";

interface OverlayState {
  kind: OverlayKind;
  /** What the user has typed to filter by. */
  query: string;
  selected: number;
}

export function App(props: TuiOptions) {
  const renderer = useRenderer();
  const t = () => theme();

  const [entries, setEntries] = createSignal<ChatEntry[]>([]);
  const [input, setInput] = createSignal("");
  // The textarea owns the text; `input` only mirrors it. onContentChange fires
  // with no payload, so the current value has to be read back off the renderable.
  let textarea: TextareaRenderable | undefined;
  let scroller: ScrollBoxRenderable | undefined;

  const [running, setRunning] = createSignal(false);
  const [model, setModel] = createSignal(props.model ?? "");
  const [pendingPermission, setPendingPermission] = createSignal<PendingPermission | null>(null);
  const [usage, setUsage] = createSignal({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  const [cost, setCost] = createSignal(0);
  const [contextTokens, setContextTokens] = createSignal(0);
  const [overlay, setOverlay] = createSignal<OverlayState | null>(null);
  const [leaderArmed, setLeaderArmed] = createSignal(false);
  const [files, setFiles] = createSignal<string[]>([]);
  const [themeTick, setThemeTick] = createSignal(0); // forces a repaint on /theme
  const [sessionList, setSessionList] = createSignal<Array<{ id: string; title: string; model: string }>>([]);

  const rt: { runtime: AgentRuntime | null; sessions: SessionStore | null; sessionId: string | null } = {
    runtime: null,
    sessions: null,
    sessionId: null,
  };
  let lastCtrlC = 0;

  const push = (entry: ChatEntry) => setEntries((prev) => [...prev, entry]);
  const patchLast = (fn: (e: ChatEntry) => ChatEntry) =>
    setEntries((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1]!)] : prev));

  onMount(async () => {
    try {
      rt.runtime = await createAgentRuntime({
        cwd: props.cwd,
        model: props.model,
        permissionPrompt: (tool, detail) =>
          new Promise<PermissionDecision>((resolve) => {
            setPendingPermission({ tool, detail, resolve });
          }),
      });
      rt.sessions = await SessionStore.create();
      if (!props.model) setModel(rt.runtime.agent.model);

      const prior = props.resume
        ? rt.sessions.get(props.resume)
        : props.continueSession
          ? rt.sessions.latest()
          : null;
      if (prior) {
        rt.runtime.agent.messages.push(...(await rt.sessions.readTranscript(prior.id)));
        rt.sessionId = prior.id;
        push({ kind: "system", text: `Resumed session ${prior.id} — ${prior.title}` });
        replayTranscript();
      } else {
        const session = await rt.sessions.createSession({ cwd: props.cwd, model: rt.runtime.agent.model });
        rt.sessionId = session.id;
        push({ kind: "system", text: welcome(rt.runtime.agent.model) });
      }

      warnIfNoKey();
      // Warm the file index in the background so the first `@` is instant.
      void indexFiles(props.cwd).then(setFiles);
    } catch (error) {
      push({ kind: "error", text: `Startup failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  function welcome(activeModel: string): string {
    return (
      `Mosaic · ${activeModel} · ${props.cwd}\n` +
      "@ file · ! shell · / commands · ctrl+p palette · ctrl+x for keys"
    );
  }

  /** Say up front if the active model has no key, rather than at first send. */
  function warnIfNoKey() {
    if (!rt.runtime) return;
    const warning = rt.runtime.agent.authWarning();
    if (warning) push({ kind: "error", text: warning });
  }

  function replayTranscript() {
    if (!rt.runtime) return;
    for (const m of rt.runtime.agent.messages) {
      if (typeof m.content === "string") {
        if (m.role === "user") push({ kind: "user", text: m.content });
        else if (m.role === "assistant" && m.content) push({ kind: "assistant", text: m.content, streaming: false });
      }
    }
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  const overlayItems = createMemo<OverlayItem[]>(() => {
    const state = overlay();
    if (!state) return [];
    themeTick(); // repaint when the palette changes

    switch (state.kind) {
      case "palette": {
        const commands: OverlayItem[] = SLASH_COMMANDS.map((c) => ({
          id: `/${c.name}`,
          label: `/${c.name}`,
          detail: c.description,
        }));
        return rank(commands, state.query);
      }
      case "slash": {
        const commands: OverlayItem[] = SLASH_COMMANDS.map((c) => ({
          id: `/${c.name}`,
          label: `/${c.name}`,
          detail: c.description,
        }));
        return rank(commands, state.query);
      }
      case "files":
        return rank(
          files().map((f) => ({ id: f, label: f })),
          state.query,
        );
      case "model": {
        const models: OverlayItem[] = Object.entries(PROVIDER_PRESETS).map(([name, preset]) => ({
          id: `${name}:${preset.exampleModel}`,
          label: `${name}:${preset.exampleModel}`,
          detail: preset.label,
        }));
        return rank(models, state.query);
      }
      case "theme":
        return rank(
          Object.keys(THEMES).map((name) => ({
            id: name,
            label: name,
            detail: name === themeName() ? "active" : undefined,
          })),
          state.query,
        );
      case "sessions":
        return rank(
          sessionList().map((s) => ({ id: s.id, label: s.title || s.id, detail: s.model })),
          state.query,
        );
    }
  });

  function rank(items: OverlayItem[], query: string): OverlayItem[] {
    if (!query) return items.slice(0, 50);
    return fuzzyFilter(items, query, (i) => i.label).map((m) => ({ ...m.item, positions: m.positions }));
  }

  /** Opened by a command, so typing filters rather than editing the message. */
  function isModalOverlay(kind: OverlayKind): boolean {
    return kind === "palette" || kind === "model" || kind === "theme" || kind === "sessions";
  }

  function isPrintable(key: { sequence?: string; ctrl?: boolean; meta?: boolean }): boolean {
    return !key.ctrl && !key.meta && !!key.sequence && key.sequence.length === 1 && key.sequence >= " ";
  }

  function openOverlay(kind: OverlayKind, query = "") {
    setOverlay({ kind, query, selected: 0 });
  }

  function closeOverlay() {
    setOverlay(null);
  }

  function moveSelection(delta: number) {
    const state = overlay();
    if (!state) return;
    const n = overlayItems().length;
    if (n === 0) return;
    setOverlay({ ...state, selected: (state.selected + delta + n) % n });
  }

  async function acceptOverlay() {
    const state = overlay();
    const item = overlayItems()[state?.selected ?? 0];
    if (!state || !item) return closeOverlay();
    closeOverlay();

    switch (state.kind) {
      case "palette":
      case "slash":
        // Put the command in the box rather than running it blind; most take
        // an argument and the user should see what they are about to send.
        replaceCurrentToken(state.kind === "slash" ? "/" : "", `${item.id} `);
        break;
      case "files":
        replaceCurrentToken("@", `@${item.id} `);
        break;
      case "model":
        await switchModel(item.id);
        break;
      case "theme":
        applyTheme(item.id);
        break;
      case "sessions":
        await resumeSession(item.id);
        break;
    }
  }

  /**
   * Swap the token being typed for `replacement`. Used by the `@` and `/`
   * pickers, which complete in place rather than appending at the end.
   */
  function replaceCurrentToken(trigger: string, replacement: string) {
    const text = input();
    const start = trigger ? lastTriggerIndex(text, trigger) : -1;
    const next = start >= 0 ? text.slice(0, start) + replacement : text + replacement;
    textarea?.setText(next);
    setInput(next);
  }

  /** Index of the trigger char for the token under the cursor, or -1. */
  function lastTriggerIndex(text: string, trigger: string): number {
    const idx = text.lastIndexOf(trigger);
    if (idx === -1) return -1;
    // Only a token: a space after the trigger means it is already complete.
    if (/\s/.test(text.slice(idx + 1))) return -1;
    // Must start a word, so an email address does not open the file picker.
    if (idx > 0 && !/\s/.test(text[idx - 1]!)) return -1;
    return idx;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function runAction(action: Action) {
    switch (action) {
      case "palette":
        openOverlay("palette");
        break;
      case "files":
        setFiles(await indexFiles(props.cwd));
        openOverlay("files");
        break;
      case "model":
        openOverlay("model");
        break;
      case "theme":
        openOverlay("theme");
        break;
      case "sessions":
        await openSessions();
        break;
      case "clear":
        await handleSlash("/clear");
        break;
      case "compact":
        await handleSlash("/compact");
        break;
      case "scroll-up":
        scroller?.scrollBy(-3);
        break;
      case "scroll-down":
        scroller?.scrollBy(3);
        break;
      case "page-up":
        scroller?.scrollBy(-15);
        break;
      case "page-down":
        scroller?.scrollBy(15);
        break;
      case "scroll-top":
        scroller?.scrollTo(0);
        break;
      case "scroll-bottom":
        if (scroller) scroller.scrollTo(scroller.scrollHeight);
        break;
      case "cancel":
        if (overlay()) closeOverlay();
        else if (running()) {
          rt.runtime?.agent.interrupt();
          push({ kind: "system", text: "Interrupted — type a redirect and press Enter to continue." });
        }
        break;
      case "quit":
        quit();
        break;
      default:
        break;
    }
  }

  function quit() {
    rt.runtime?.close();
    rt.sessions?.close();
    renderer.destroy();
    process.exit(0);
  }

  function applyTheme(name: string) {
    if (!setTheme(name)) return;
    setThemeTick((n) => n + 1);
    push({ kind: "system", text: `Theme → ${name}` });
  }

  async function openSessions() {
    if (!rt.sessions) return;
    const list = rt.sessions.list(50).map((s) => ({ id: s.id, title: s.title, model: s.model }));
    setSessionList(list);
    if (!list.length) {
      push({ kind: "system", text: "No saved sessions yet." });
      return;
    }
    openOverlay("sessions");
  }

  async function resumeSession(id: string) {
    const sessions = rt.sessions;
    const runtime = rt.runtime;
    if (!sessions || !runtime) return;
    const target = sessions.get(id);
    if (!target) {
      push({ kind: "error", text: `No session ${id}` });
      return;
    }
    runtime.agent.messages.length = 0;
    runtime.agent.messages.push(...(await sessions.readTranscript(target.id)));
    rt.sessionId = target.id;
    setEntries([]);
    push({ kind: "system", text: `Resumed ${target.id} — ${target.title}` });
    replayTranscript();
    setContextTokens(estimateContextTokens("", runtime.agent.messages));
  }

  async function switchModel(next: string) {
    if (!next) {
      push({ kind: "system", text: `Current model: ${model()}` });
      return;
    }
    setModel(next);
    const oldMessages = rt.runtime?.agent.messages ?? [];
    rt.runtime?.close();
    rt.runtime = await createAgentRuntime({
      cwd: props.cwd,
      model: next,
      permissionPrompt: (tool, detail) =>
        new Promise<PermissionDecision>((resolve) => setPendingPermission({ tool, detail, resolve })),
    });
    rt.runtime.agent.messages.push(...oldMessages);
    push({ kind: "system", text: `Model → ${next}` });
    warnIfNoKey();
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  // Global handler: Ctrl+C and permission answers, which must work regardless
  // of where focus sits.
  const keyHandler = (key: { name: string; ctrl: boolean; preventDefault: () => void }) => {
    if (key.ctrl && key.name === "c") {
      const now = Date.now();
      if (now - lastCtrlC < 1000) return quit();
      lastCtrlC = now;
      push({ kind: "system", text: "Ctrl+C again to quit" });
      return;
    }
    const pending = pendingPermission();
    if (pending) {
      if (key.name === "y") resolvePermission("allow-once");
      else if (key.name === "a") resolvePermission("allow-always");
      else if (key.name === "n" || key.name === "escape") resolvePermission("deny");
    }
  };
  renderer.keyInput.on("keypress", keyHandler);
  onCleanup(() => renderer.keyInput.off("keypress", keyHandler));

  /**
   * Input-box keys. Handled here rather than globally because this is where
   * preventDefault can stop a keystroke from also being typed into the box.
   */
  function onInputKey(key: {
    name: string;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
    sequence?: string;
    preventDefault: () => void;
  }) {
    if (pendingPermission()) {
      key.preventDefault(); // the permission prompt owns the keyboard
      return;
    }

    // Leader: ctrl+x, then a letter.
    if (leaderArmed()) {
      setLeaderArmed(false);
      key.preventDefault();
      const action = matchLeader(key);
      if (action) void runAction(action);
      return;
    }
    if (isLeader(key)) {
      setLeaderArmed(true);
      key.preventDefault();
      return;
    }

    const state = overlay();
    if (state) {
      switch (key.name) {
        case "up":
          key.preventDefault();
          return moveSelection(-1);
        case "down":
          key.preventDefault();
          return moveSelection(1);
        case "tab":
        case "return":
          key.preventDefault();
          void acceptOverlay();
          return;
        case "escape":
          key.preventDefault();
          return closeOverlay();
      }

      // `@` and `/` complete inline, so their query is just the text in the box
      // and syncOverlay() derives it. The pickers opened by a command have no
      // text to derive from: typing has to filter the list instead of being
      // appended to a message the user is not writing.
      if (isModalOverlay(state.kind)) {
        if (key.name === "backspace") {
          key.preventDefault();
          setOverlay({ ...state, query: state.query.slice(0, -1), selected: 0 });
          return;
        }
        if (isPrintable(key)) {
          key.preventDefault();
          setOverlay({ ...state, query: state.query + key.sequence, selected: 0 });
          return;
        }
      }
    }

    const direct = matchDirect(key);
    if (direct && !(direct === "cancel" && !state && !running())) {
      key.preventDefault();
      void runAction(direct);
      return;
    }

    if (key.name === "return" && !key.shift) {
      key.preventDefault();
      void submit();
    }
  }

  /**
   * Re-derive overlay state from the text after every edit, so `@src/` narrows
   * the file list and deleting the `@` closes it.
   */
  function syncOverlay(text: string) {
    const state = overlay();
    // Pickers driven by a command rather than by text stay put.
    if (state && state.kind !== "files" && state.kind !== "slash") return;

    const at = lastTriggerIndex(text, "@");
    if (at >= 0) {
      const query = text.slice(at + 1);
      if (!files().length) void indexFiles(props.cwd).then(setFiles);
      setOverlay({ kind: "files", query, selected: 0 });
      return;
    }

    if (text.startsWith("/") && !text.includes(" ")) {
      setOverlay({ kind: "slash", query: text.slice(1), selected: 0 });
      return;
    }

    if (state) closeOverlay();
  }

  function resolvePermission(decision: PermissionDecision) {
    const pending = pendingPermission();
    if (!pending) return;
    setPendingPermission(null);
    pending.resolve(decision);
    push({
      kind: "system",
      text: `${pending.tool}: ${decision === "deny" ? "denied" : decision === "allow-always" ? "always allowed" : "allowed once"}`,
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit() {
    const text = input().trim();
    if (!text) return;
    closeOverlay();
    textarea?.setText("");
    setInput("");

    if (running()) {
      rt.runtime?.agent.queueRedirect(text);
      push({ kind: "system", text: `Queued redirect: ${text}` });
      return;
    }
    if (text.startsWith("!")) return runShell(text.slice(1).trim());
    if (text.startsWith("/")) return handleSlash(text);
    await runAgent(text);
  }

  /**
   * `!cmd` — run a shell command directly. No permission prompt: the user typed
   * it themselves, which is the whole point of the prefix. The result is added
   * to the conversation so the model can see what happened.
   */
  async function runShell(command: string) {
    if (!command) return;
    const id = `shell-${Date.now()}`;
    push({ kind: "tool", id, name: "shell", arguments: JSON.stringify({ command }), result: "", isError: false, collapsed: false, running: true });

    try {
      const proc = Bun.spawn(["bash", "-lc", command], { cwd: props.cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const code = await proc.exited;
      const output = (stdout + stderr).trim() || `(no output, exit ${code})`;
      setEntries((prev) =>
        prev.map((e) => (e.kind === "tool" && e.id === id ? { ...e, result: output, isError: code !== 0, running: false } : e)),
      );
      rt.runtime?.agent.messages.push({ role: "user", content: `I ran \`${command}\` and got:\n\n${output}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEntries((prev) =>
        prev.map((e) => (e.kind === "tool" && e.id === id ? { ...e, result: message, isError: true, running: false } : e)),
      );
    }
  }

  /** Inline the contents of every `@path` so the model sees the file, not the name. */
  async function expandReferences(text: string): Promise<string> {
    const refs = [...text.matchAll(/(?:^|\s)@([^\s]+)/g)].map((m) => m[1]!);
    if (!refs.length) return text;

    const seen = new Set<string>();
    const blocks: string[] = [];
    for (const ref of refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const content = await readReference(props.cwd, ref);
      if (content === null) {
        push({ kind: "system", text: `@${ref} — not a readable text file, sent as plain text.` });
        continue;
      }
      blocks.push(`--- ${ref} ---\n${content}`);
    }
    return blocks.length ? `${text}\n\n${blocks.join("\n\n")}` : text;
  }

  async function runAgent(rawText: string) {
    if (!rt.runtime || running()) return;
    setRunning(true);
    push({ kind: "user", text: rawText });
    push({ kind: "assistant", text: "", streaming: true });

    const text = await expandReferences(rawText);
    setContextTokens(estimateContextTokens("", rt.runtime.agent.messages));

    try {
      for await (const event of rt.runtime.agent.run(text)) {
        switch (event.type) {
          case "text":
            patchLast((e) => (e.kind === "assistant" ? { ...e, text: e.text + event.text } : e));
            break;
          case "tool_start":
            push({
              kind: "tool",
              id: event.id,
              name: event.name,
              arguments: event.arguments,
              result: "",
              isError: false,
              collapsed: false,
              running: true,
            });
            break;
          case "tool_result":
            setEntries((prev) =>
              prev.map((e) =>
                e.kind === "tool" && e.id === event.id
                  ? { ...e, result: event.result, isError: event.isError, running: false, collapsed: !event.isError }
                  : e,
              ),
            );
            break;
          case "usage":
            setUsage({
              inputTokens: event.totals.inputTokens,
              outputTokens: event.totals.outputTokens,
              cacheReadTokens: event.totals.cacheReadTokens ?? 0,
            });
            setCost(rt.runtime!.agent.meter.estimateCost());
            if (rt.sessionId && rt.sessions) await rt.sessions.addUsage(rt.sessionId, event.usage);
            break;
          case "compaction":
            push({
              kind: "system",
              text: `Compacted ${event.droppedMessages} messages (~${event.estimatedBefore} → ~${event.estimatedAfter} tokens)`,
            });
            break;
          case "error":
            push({ kind: "error", text: event.error.message });
            break;
          default:
            break;
        }
      }
    } finally {
      patchLast((e) => (e.kind === "assistant" ? { ...e, streaming: false } : e));
      setRunning(false);
      setContextTokens(estimateContextTokens("", rt.runtime!.agent.messages));
      if (rt.sessions && rt.sessionId) {
        await rt.sessions.replaceTranscript(rt.sessionId, rt.runtime!.agent.messages);
        if (entries().filter((e) => e.kind === "user").length === 1) {
          await rt.sessions.setTitle(rt.sessionId, rawText.slice(0, 60));
        }
      }
    }
  }

  // ── Slash commands ────────────────────────────────────────────────────────

  async function handleSlash(text: string) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ");

    switch (cmd) {
      case "help":
        push({
          kind: "system",
          text:
            "Commands:\n" +
            SLASH_COMMANDS.map((c) => `  /${c.name.padEnd(10)} ${c.description}`).join("\n") +
            "\n\nKeys:\n" +
            KEY_HELP.map(([k, d]) => `  ${k.padEnd(12)} ${d}`).join("\n"),
        });
        break;
      case "keys":
        push({ kind: "system", text: KEY_HELP.map(([k, d]) => `  ${k.padEnd(12)} ${d}`).join("\n") });
        break;
      case "model":
        if (arg) await switchModel(arg);
        else openOverlay("model");
        break;
      case "theme":
        if (arg) {
          if (!setTheme(arg)) push({ kind: "error", text: `Unknown theme "${arg}". Have: ${Object.keys(THEMES).join(", ")}` });
          else applyTheme(arg);
        } else openOverlay("theme");
        break;
      case "sessions":
        await openSessions();
        break;
      case "clear": {
        rt.runtime?.agent.messages.splice(0);
        rt.runtime?.agent.meter.reset();
        setEntries([]);
        setUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
        setCost(0);
        setContextTokens(0);
        if (rt.sessions) {
          const session = await rt.sessions.createSession({ cwd: props.cwd, model: model() });
          rt.sessionId = session.id;
        }
        push({ kind: "system", text: "Cleared — new session started." });
        break;
      }
      case "compact": {
        if (!rt.runtime) break;
        const result = compactDeterministic(rt.runtime.agent.messages, {
          contextWindow: rt.runtime.config.tokens.contextWindow,
          compactAt: rt.runtime.config.tokens.compactAt,
          keepLastTurns: rt.runtime.config.tokens.keepLastTurns,
        });
        if (result.compacted) {
          rt.runtime.agent.messages.length = 0;
          rt.runtime.agent.messages.push(...result.messages);
          setContextTokens(estimateContextTokens("", rt.runtime.agent.messages));
          push({
            kind: "system",
            text: `Compacted ${result.droppedMessages} messages (~${result.estimatedBefore} → ~${result.estimatedAfter} tokens).`,
          });
        } else {
          push({ kind: "system", text: "Nothing to compact yet." });
        }
        break;
      }
      case "cost": {
        if (!rt.runtime) break;
        const totals = rt.runtime.agent.meter.totals();
        push({
          kind: "system",
          text:
            `Turns: ${totals.turns}\nInput: ${totals.inputTokens} tokens\nOutput: ${totals.outputTokens} tokens\n` +
            `Cache reads: ${totals.cacheReadTokens ?? 0}\nEstimated cost: $${rt.runtime.agent.meter.estimateCost().toFixed(4)}`,
        });
        break;
      }
      case "memory": {
        if (!rt.runtime?.memory) {
          push({ kind: "system", text: "Memory is disabled." });
          break;
        }
        const memories = rt.runtime.memory.list(props.cwd, 30);
        push({
          kind: "system",
          text: memories.length
            ? memories.map((m) => `[${m.id}] (${m.kind}) ${m.content}`).join("\n")
            : "No memories stored yet.",
        });
        break;
      }
      case "export": {
        if (!rt.runtime) break;
        const path = arg || `mosaic-${rt.sessionId ?? "session"}.md`;
        const markdown = entries()
          .map((e) => {
            if (e.kind === "user") return `## User\n\n${e.text}`;
            if (e.kind === "assistant") return `## Assistant\n\n${e.text}`;
            if (e.kind === "tool") return `### tool: ${e.name}\n\n\`\`\`\n${e.result}\n\`\`\``;
            return "";
          })
          .filter(Boolean)
          .join("\n\n");
        await Bun.write(path, markdown);
        push({ kind: "system", text: `Exported ${entries().length} entries → ${path}` });
        break;
      }
      case "resume":
        if (arg) await resumeSession(arg);
        else await openSessions();
        break;
      case "files":
        invalidateFileIndex();
        setFiles(await indexFiles(props.cwd, true));
        push({ kind: "system", text: `Reindexed ${files().length} files.` });
        break;
      case "login":
        await loginFlow(arg);
        break;
      default:
        push({ kind: "error", text: `Unknown command /${cmd} — /help for the list` });
    }
  }

  /**
   * Keys are secrets and this transcript is written to disk, so the TUI never
   * takes one as typed input — it points at the CLI, which stores it 0600.
   */
  async function loginFlow(provider: string) {
    if (!provider) {
      const names = Object.entries(PROVIDER_PRESETS)
        .map(([n, p]) => `  ${n.padEnd(12)} ${p.label}${p.keyless ? " — no key needed" : ""}`)
        .join("\n");
      push({ kind: "system", text: `Usage: /login <provider>\n\n${names}` });
      return;
    }
    const preset = PROVIDER_PRESETS[provider];
    if (preset?.keyless) {
      push({ kind: "system", text: `${preset.label} runs locally — no key needed. Try /model ${provider}:${preset.exampleModel}` });
      return;
    }
    const env = rt.runtime ? keyEnvFor(rt.runtime.config, provider) : `${provider.toUpperCase()}_API_KEY`;
    push({
      kind: "system",
      text:
        `To use ${preset?.label ?? provider}, either:\n` +
        `  export ${env}=<your-key>\n` +
        `  mosaic login ${provider} --key <your-key>\n` +
        (preset?.keyUrl ? `\nGet a key at ${preset.keyUrl}` : ""),
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const overlayTitle = (kind: OverlayKind) =>
    ({
      palette: "Commands",
      slash: "Commands",
      files: "Files",
      model: "Model",
      theme: "Theme",
      sessions: "Sessions",
    })[kind];

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={(themeTick(), undefined)}>
      <scrollbox ref={scroller} flexGrow={1} stickyScroll stickyStart="bottom" paddingLeft={1} paddingRight={1}>
        <For each={entries()}>{(entry) => <MessageView entry={entry} />}</For>
      </scrollbox>

      <Show when={pendingPermission()}>
        {(pending) => <PermissionPrompt tool={pending().tool} detail={pending().detail} />}
      </Show>

      <Show when={overlay()}>
        {(state) => (
          <Overlay
            title={overlayTitle(state().kind)}
            items={overlayItems()}
            selected={state().selected}
            hint="↑↓ tab ⏎ esc"
            empty={state().kind === "files" ? "No matching files" : "No matches"}
          />
        )}
      </Show>

      <Show when={leaderArmed()}>
        <box marginLeft={1}>
          <text fg={t().accent}>ctrl+x … (f files · s sessions · m model · t theme · k compact · c clear · q quit)</text>
        </box>
      </Show>

      <box
        border
        borderStyle="rounded"
        borderColor={running() ? t().warning : t().border}
        marginLeft={1}
        marginRight={1}
      >
        <textarea
          ref={textarea}
          placeholder={
            running()
              ? "Running — esc interrupts, or type a redirect"
              : "Message Mosaic…   @ file · ! shell · / commands · ctrl+p palette"
          }
          onContentChange={() => {
            const text = textarea?.plainText ?? "";
            setInput(text);
            syncOverlay(text);
          }}
          onKeyDown={onInputKey}
          focused
          minHeight={1}
          maxHeight={8}
        />
      </box>

      <StatusBar
        model={model()}
        contextTokens={contextTokens()}
        contextWindow={rt.runtime?.config.tokens.contextWindow ?? 128_000}
        inputTokens={usage().inputTokens}
        outputTokens={usage().outputTokens}
        cacheReadTokens={usage().cacheReadTokens}
        cost={cost()}
        running={running()}
      />
    </box>
  );
}
