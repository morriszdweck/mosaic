import { SessionStore } from "@mosaic/core";

/** mosaic sessions — list recent sessions. */
export async function sessionsCommand(): Promise<number> {
  const store = await SessionStore.create();
  try {
    const sessions = store.list(20);
    if (!sessions.length) {
      console.log("No sessions yet.");
      return 0;
    }
    for (const s of sessions) {
      const when = new Date(s.updatedAt).toISOString().replace("T", " ").slice(0, 16);
      const tokens = `${s.inputTokens + s.outputTokens} tok`;
      console.log(`${s.id}  ${when}  ${tokens.padStart(10)}  ${s.title}  [${s.cwd}]`);
    }
    return 0;
  } finally {
    store.close();
  }
}
