import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { TextareaRenderable } from "@opentui/core";
import {
  compactDeterministic,
  createAgentRuntime,
  estimateContextTokens,
  pollForToken,
  requestDeviceCode,
  SessionStore,
  type AgentRuntime,
  type PermissionDecision,
} from "@mosaic/core";
import { MessageView } from "./components/MessageView.tsx";
import { PermissionPrompt } from "./components/PermissionPrompt.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
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

export function App(props: TuiOptions) {
  const renderer = useRenderer();

  const [entries, setEntries] = createSignal<ChatEntry[]>([]);
  const [input, setInput] = createSignal("");
  // The textarea owns the text; `input` only mirrors it. onContentChange fires
  // with no payload, so the current value has to be read back off the renderable.
  let textarea: TextareaRenderable | undefined;
  const [running, setRunning] = createSignal(false);
  const [model, setModel] = createSignal(props.model ?? "");
  const [pendingPermission, setPendingPermission] = createSignal<PendingPermission | null>(null);
  const [usage, setUsage] = createSignal({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  const [cost, setCost] = createSignal(0);
  const [contextTokens, setContextTokens] = createSignal(0);

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

      // Resume: --resume <id> or --continue (latest).
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
        push({
          kind: "system",
          text: `Mosaic — ${rt.runtime.agent.model} · ${props.cwd} · /help for commands · Esc to interrupt`,
        });
      }
    } catch (error) {
      push({ kind: "error", text: `Startup failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  function replayTranscript() {
    if (!rt.runtime) return;
    for (const m of rt.runtime.agent.messages) {
      if (typeof m.content === "string") {
        if (m.role === "user") push({ kind: "user", text: m.content });
        else if (m.role === "assistant" && m.content) push({ kind: "assistant", text: m.content, streaming: false });
      }
    }
  }

  // Global keys: Esc interrupts, Ctrl+C double-tap quits, y/a/n answer permissions.
  const keyHandler = (key: { name: string; ctrl: boolean; preventDefault: () => void }) => {
    if (key.ctrl && key.name === "c") {
      const now = Date.now();
      if (now - lastCtrlC < 1000) {
        rt.runtime?.close();
        rt.sessions?.close();
        renderer.destroy();
        process.exit(0);
      }
      lastCtrlC = now;
      push({ kind: "system", text: "Ctrl+C again to quit" });
      return;
    }
    const pending = pendingPermission();
    if (pending && !running()) {
      // not expected, but don't swallow keys
    }
    if (pending) {
      if (key.name === "y") resolvePermission("allow-once");
      else if (key.name === "a") resolvePermission("allow-always");
      else if (key.name === "n" || key.name === "escape") resolvePermission("deny");
      return;
    }
    if (key.name === "escape" && running()) {
      rt.runtime?.agent.interrupt();
      push({ kind: "system", text: "Interrupted — type a redirect and press Enter to continue from here." });
    }
  };
  renderer.keyInput.on("keypress", keyHandler);
  onCleanup(() => renderer.keyInput.off("keypress", keyHandler));

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

  async function submit() {
    const text = input().trim();
    if (!text) return;
    // Clear the textarea itself, not just the mirror, or the sent text stays on
    // screen. setText does not fire onContentChange, so reset the signal too.
    textarea?.setText("");
    setInput("");

    if (running()) {
      // busy: queue as redirect
      rt.runtime?.agent.queueRedirect(text);
      return;
    }
    if (text.startsWith("/")) {
      await handleSlash(text);
      return;
    }
    await runAgent(text);
  }

  async function runAgent(text: string) {
    if (!rt.runtime || running()) return;
    setRunning(true);
    push({ kind: "user", text });
    push({ kind: "assistant", text: "", streaming: true });
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
              text: `Compacted context: ${event.droppedMessages} old messages → digest (~${event.estimatedBefore} → ~${event.estimatedAfter} tokens)`,
            });
            break;
          case "interrupted":
            break;
          case "error":
            push({ kind: "error", text: event.error.message });
            break;
          case "turn_end":
            break;
        }
      }
    } finally {
      patchLast((e) => (e.kind === "assistant" ? { ...e, streaming: false } : e));
      setRunning(false);
      setContextTokens(estimateContextTokens("", rt.runtime!.agent.messages));
      if (rt.sessions && rt.sessionId) {
        for (const m of rt.runtime!.agent.messages) await rt.sessions.appendMessage(rt.sessionId, m);
        if (entries().filter((e) => e.kind === "user").length === 1) {
          await rt.sessions.setTitle(rt.sessionId, text.slice(0, 60));
        }
      }
    }
  }

  async function handleSlash(text: string) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "help":
        push({
          kind: "system",
          text:
            "Commands:\n" +
            SLASH_COMMANDS.map((c) => `  /${c.name} — ${c.description}`).join("\n") +
            "\nKeys: Enter submit · Shift+Enter newline · Esc interrupt · Ctrl+C×2 quit · y/a/n answer permissions",
        });
        break;
      case "model": {
        if (!arg) {
          push({ kind: "system", text: `Current model: ${model()}` });
        } else {
          setModel(arg);
          // Rebuild the runtime with the new model.
          const oldMessages = rt.runtime?.agent.messages ?? [];
          rt.runtime?.close();
          rt.runtime = await createAgentRuntime({
            cwd: props.cwd,
            model: arg,
            permissionPrompt: (tool, detail) =>
              new Promise<PermissionDecision>((resolve) => setPendingPermission({ tool, detail, resolve })),
          });
          rt.runtime.agent.messages.push(...oldMessages);
          push({ kind: "system", text: `Switched model → ${arg}` });
        }
        break;
      }
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
          push({ kind: "system", text: `Compacted ${result.droppedMessages} messages (~${result.estimatedBefore} → ~${result.estimatedAfter} tokens).` });
        } else {
          push({ kind: "system", text: "Nothing to compact yet." });
        }
        break;
      }
      case "cost": {
        if (!rt.runtime) break;
        const t = rt.runtime.agent.meter.totals();
        push({
          kind: "system",
          text:
            `Turns: ${t.turns}\nInput: ${t.inputTokens} tokens\nOutput: ${t.outputTokens} tokens\n` +
            `Cache reads: ${t.cacheReadTokens ?? 0}\nEstimated cost: $${rt.runtime.agent.meter.estimateCost().toFixed(4)}`,
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
      case "resume": {
        const sessions = rt.sessions;
        if (!sessions || !rt.runtime) break;
        const runtime = rt.runtime;
        const target = arg ? sessions.get(arg) : sessions.latest();
        if (!target) {
          push({ kind: "system", text: "No session found. Use `mosaic sessions` to list ids." });
          break;
        }
        runtime.agent.messages.length = 0;
        runtime.agent.messages.push(...(await sessions.readTranscript(target.id)));
        rt.sessionId = target.id;
        push({ kind: "system", text: `Resumed ${target.id} — ${target.title}` });
        replayTranscript();
        break;
      }
      case "login": {
        await loginFlow(arg || "codex");
        break;
      }
      default:
        push({ kind: "error", text: `Unknown command /${cmd} — /help for the list` });
    }
  }

  async function loginFlow(provider: string) {
    if (provider === "codex") {
      push({ kind: "system", text: "Starting ChatGPT device sign-in…" });
      try {
        const device = await requestDeviceCode();
        push({
          kind: "system",
          text: `Open ${device.verificationUriComplete ?? device.verificationUri}` +
            (device.verificationUriComplete ? "" : ` and enter code ${device.userCode}`) +
            "\nWaiting for approval…",
        });
        const credential = await pollForToken(device.deviceCode);
        await rt.runtime?.authStore.set("codex", credential);
        push({ kind: "system", text: "✓ Signed in with ChatGPT (codex)." });
      } catch (error) {
        push({ kind: "error", text: `Login failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    } else {
      push({
        kind: "system",
        text: `To sign in ${provider}, run: mosaic login ${provider} --key <your-key>`,
      });
    }
  }

  const slashMatches = () => {
    const v = input();
    if (!v.startsWith("/") || v.includes(" ")) return [];
    const prefix = v.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingLeft={1} paddingRight={1}>
        <For each={entries()}>{(entry) => <MessageView entry={entry} />}</For>
      </scrollbox>

      <Show when={pendingPermission()}>
        {(p) => <PermissionPrompt tool={p().tool} detail={p().detail} onDecision={resolvePermission} />}
      </Show>

      <Show when={slashMatches().length > 0}>
        <box flexDirection="column" paddingLeft={1}>
          <For each={slashMatches()}>
            {(cmd) => (
              <text fg="#565f89">
                /{cmd.name} — {cmd.description}
              </text>
            )}
          </For>
        </box>
      </Show>

      <box border borderStyle="rounded" borderColor={running() ? "#e0af68" : "#3b4261"} marginLeft={1} marginRight={1}>
        <textarea
          ref={textarea}
          placeholder={running() ? "Agent is running — Esc to interrupt, or type a redirect" : "Message Mosaic… (/ for commands)"}
          onContentChange={() => setInput(textarea?.plainText ?? "")}
          onKeyDown={(key) => {
            if (key.name === "return" && !key.shift) {
              key.preventDefault();
              void submit();
            }
          }}
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
