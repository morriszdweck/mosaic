import { createAgentRuntime, SessionStore } from "@mosaic/core";

/**
 * Headless mode: `mosaic -p "..."` — run one prompt, stream the answer to
 * stdout, tool activity to stderr, exit. No interactive permissions: the
 * permission gate falls back to allow-once for everything.
 */
export async function headless(options: {
  prompt: string;
  cwd: string;
  model?: string;
  resume?: string;
  continueSession?: boolean;
}): Promise<number> {
  const runtime = await createAgentRuntime({ cwd: options.cwd, model: options.model });
  const sessions = await SessionStore.create();

  try {
    const session = await sessions.createSession({
      cwd: options.cwd,
      model: runtime.agent.model,
      title: options.prompt.slice(0, 60),
    });

    if (options.resume || options.continueSession) {
      const prior = options.resume ? sessions.get(options.resume) : sessions.latest();
      if (prior) {
        const transcript = await sessions.readTranscript(prior.id);
        runtime.agent.messages.push(...transcript);
      }
    }

    const status = (msg: string) => process.stderr.write(`\x1b[2m${msg}\x1b[0m\n`);

    for await (const event of runtime.agent.run(options.prompt)) {
      switch (event.type) {
        case "text":
          process.stdout.write(event.text);
          break;
        case "tool_start":
          status(`⚙ ${event.name}`);
          break;
        case "tool_result":
          status(event.isError ? `✗ ${event.name} failed` : `✓ ${event.name}`);
          break;
        case "compaction":
          status(`compacted ${event.droppedMessages} messages (~${event.estimatedBefore}→~${event.estimatedAfter} tokens)`);
          break;
        case "error":
          status(`error: ${event.error.message}`);
          break;
        case "interrupted":
          status("interrupted");
          break;
      }
      if (event.type === "usage") await sessions.addUsage(session.id, event.usage);
    }
    process.stdout.write("\n");

    for (const m of runtime.agent.messages) await sessions.appendMessage(session.id, m);
    const totals = runtime.agent.meter.totals();
    status(
      `done — ${totals.inputTokens} in / ${totals.outputTokens} out` +
        (totals.cacheReadTokens ? ` (${totals.cacheReadTokens} cached)` : ""),
    );
    return 0;
  } finally {
    sessions.close();
    runtime.close();
  }
}
