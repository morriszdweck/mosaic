import type { Message, Provider } from "../types.ts";
import { textOf } from "../types.ts";
import { estimateContextTokens } from "./meter.ts";

/**
 * Auto-compaction: when the estimated context crosses a fraction of the model's
 * window, older turns are summarized into a single compacted message while the
 * last N turns stay verbatim. Runs inside the agent loop between turns.
 */

export interface CompactionOptions {
  contextWindow: number;
  compactAt: number; // e.g. 0.8
  keepLastTurns: number; // user+assistant pairs kept verbatim
}

export interface CompactionResult {
  messages: Message[];
  compacted: boolean;
  droppedMessages: number;
  estimatedBefore: number;
  estimatedAfter: number;
}

export function needsCompaction(system: string, messages: Message[], options: CompactionOptions): boolean {
  const threshold = options.contextWindow * options.compactAt;
  return estimateContextTokens(system, messages) > threshold;
}

/**
 * Deterministic compaction (no LLM call): collapses old turns into a terse
 * structured digest. Cheap and safe — used as the default; an LLM-summarized
 * variant can be layered on via compactWithSummary().
 */
export function compactDeterministic(messages: Message[], options: CompactionOptions): CompactionResult {
  const estimatedBefore = estimateContextTokens("", messages);

  // Keep the last N "turns" = user messages and everything after them.
  const keepFrom = findKeepIndex(messages, options.keepLastTurns);
  const old = messages.slice(0, keepFrom);
  const kept = messages.slice(keepFrom);

  if (!old.length) {
    return { messages, compacted: false, droppedMessages: 0, estimatedBefore, estimatedAfter: estimatedBefore };
  }

  const digest = buildDigest(old);
  const compactedMessage: Message = {
    role: "user",
    content:
      "[Earlier conversation compacted to save context. Digest follows.]\n" + digest +
      "\n[End of digest — recent turns follow verbatim.]",
    compacted: true,
  };

  const messages2 = [compactedMessage, ...kept];
  return {
    messages: messages2,
    compacted: true,
    droppedMessages: old.length,
    estimatedBefore,
    estimatedAfter: estimateContextTokens("", messages2),
  };
}

/** LLM-assisted compaction: summarize old turns with a small model, falling back to deterministic. */
export async function compactWithSummary(
  messages: Message[],
  options: CompactionOptions,
  provider: Provider,
  model: string,
): Promise<CompactionResult> {
  const keepFrom = findKeepIndex(messages, options.keepLastTurns);
  const old = messages.slice(0, keepFrom);
  if (!old.length) return compactDeterministic(messages, options);

  try {
    const transcript = old
      .map((m) => {
        const text = textOf(m).slice(0, 800);
        return text ? `${m.role}: ${text}` : `${m.role}: [tool activity]`;
      })
      .join("\n");

    let summary = "";
    for await (const event of provider.chat({
      model,
      messages: [
        {
          role: "user",
          content:
            "Summarize this agent conversation transcript into a compact digest (<= 400 words): " +
            "decisions made, files touched, key facts, pending tasks. Plain text, no preamble.\n\n" + transcript,
        },
      ],
      tools: [],
      maxTokens: 1024,
    })) {
      if (event.type === "text_delta") summary += event.text;
    }

    if (summary.trim()) {
      const compactedMessage: Message = {
        role: "user",
        content: `[Earlier conversation summarized to save context.]\n${summary.trim()}\n[End of summary — recent turns follow verbatim.]`,
        compacted: true,
      };
      const messages2 = [compactedMessage, ...messages.slice(keepFrom)];
      return {
        messages: messages2,
        compacted: true,
        droppedMessages: old.length,
        estimatedBefore: estimateContextTokens("", messages),
        estimatedAfter: estimateContextTokens("", messages2),
      };
    }
  } catch {
    // fall through to deterministic
  }
  return compactDeterministic(messages, options);
}

/** Index of the first message to keep verbatim: the start of the Nth-from-last user turn. */
export function findKeepIndex(messages: Message[], keepLastTurns: number): number {
  let userTurnsSeen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user" && !messages[i]!.compacted) {
      userTurnsSeen++;
      if (userTurnsSeen >= keepLastTurns) return i;
    }
  }
  return messages.length; // nothing old enough to compact
}

function buildDigest(messages: Message[]): string {
  const filesTouched = new Set<string>();
  const decisions: string[] = [];
  const pending: string[] = [];

  for (const m of messages) {
    if (typeof m.content !== "string") {
      for (const part of m.content) {
        if (part.type === "tool_call") {
          try {
            const args = JSON.parse(part.arguments || "{}") as Record<string, unknown>;
            if (typeof args.path === "string") filesTouched.add(`${part.name}: ${args.path}`);
            else if (typeof args.command === "string") filesTouched.add(`bash: ${args.command.slice(0, 80)}`);
          } catch {
            // ignore malformed args
          }
        }
      }
      continue;
    }
    const text = m.content;
    if (m.role === "assistant") {
      for (const line of text.split("\n")) {
        if (/\b(will|going to|next step|todo|need to)\b/i.test(line) && pending.length < 8) {
          pending.push(line.trim().slice(0, 200));
        } else if (/\b(decided|chose|because|approach)\b/i.test(line) && decisions.length < 8) {
          decisions.push(line.trim().slice(0, 200));
        }
      }
    }
  }

  const sections: string[] = [];
  if (filesTouched.size) sections.push(`Files/commands touched:\n${[...filesTouched].slice(0, 20).join("\n")}`);
  if (decisions.length) sections.push(`Key points:\n${decisions.join("\n")}`);
  if (pending.length) sections.push(`Pending:\n${pending.join("\n")}`);
  return sections.join("\n\n") || "(no notable content in compacted turns)";
}
