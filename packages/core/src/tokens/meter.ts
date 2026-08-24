import type { Message, Usage } from "../types.ts";
import { textOf } from "../types.ts";

/**
 * Token accounting.
 * - estimate(): fast heuristic (~4 chars/token, with a per-message overhead)
 *   used for context-pressure decisions before/without provider data.
 * - TokenMeter: exact per-turn accounting from provider usage events,
 *   surfaced in /cost and the status bar.
 */

const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: Message): number {
  let chars = 0;
  if (typeof message.content === "string") {
    chars = message.content.length;
  } else {
    for (const part of message.content) {
      if (part.type === "text") chars += part.text.length;
      else if (part.type === "tool_call") chars += part.name.length + part.arguments.length;
      else chars += part.content.length + part.name.length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD;
}

export function estimateContextTokens(system: string, messages: Message[]): number {
  let total = estimateTokens(system);
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

export interface TurnUsage {
  turn: number;
  usage: Usage;
  at: number;
}

export class TokenMeter {
  private readonly turns: TurnUsage[] = [];
  private turnCounter = 0;

  recordTurn(usage: Usage): void {
    this.turnCounter++;
    this.turns.push({ turn: this.turnCounter, usage, at: Date.now() });
  }

  totals(): Usage & { turns: number } {
    const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: this.turns.length };
    for (const t of this.turns) {
      total.inputTokens += t.usage.inputTokens;
      total.outputTokens += t.usage.outputTokens;
      total.cacheReadTokens += t.usage.cacheReadTokens ?? 0;
      total.cacheWriteTokens += t.usage.cacheWriteTokens ?? 0;
    }
    return total;
  }

  lastTurn(): TurnUsage | undefined {
    return this.turns[this.turns.length - 1];
  }

  /**
   * Rough cost estimate in USD for display in /cost.
   * Prices are indicative defaults; config can override later. Cache reads
   * are charged at 10% of input price (Anthropic-style discount).
   */
  estimateCost(inputPer1M = 0.15, outputPer1M = 0.6): number {
    const t = this.totals();
    const cacheRead = t.cacheReadTokens ?? 0;
    const inputCost = ((t.inputTokens - cacheRead) / 1_000_000) * inputPer1M;
    const cacheCost = (cacheRead / 1_000_000) * inputPer1M * 0.1;
    const outputCost = (t.outputTokens / 1_000_000) * outputPer1M;
    return inputCost + cacheCost + outputCost;
  }

  reset(): void {
    this.turns.length = 0;
    this.turnCounter = 0;
  }
}
