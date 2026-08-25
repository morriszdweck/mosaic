import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../src/memory/store.ts";
import { SessionStore } from "../src/session/store.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mosaic-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  test("save → recall by keyword overlap → forget", async () => {
    const store = await MemoryStore.create(join(dir, "mem.db"));
    try {
      const m1 = store.save({ kind: "preference", content: "User prefers dark themes and minimal UIs", project: "/repo" });
      store.save({ kind: "fact", content: "The build uses bun build --compile", project: "/repo" });
      store.save({ kind: "fact", content: "Unrelated note about lunch menus", project: "/other" });

      const hits = store.recall("what theme does the user prefer?", 5, "/repo");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.id).toBe(m1.id);

      // project isolation
      const all = store.list("/repo");
      expect(all.length).toBe(2);

      expect(store.forget(m1.id)).toBe(true);
      expect(store.recall("dark themes", 5, "/repo").some((m) => m.id === m1.id)).toBe(false);
      expect(store.count()).toBe(2);
    } finally {
      store.close();
    }
  });
});

describe("SessionStore", () => {
  test("create, append, read, fork, rewind", async () => {
    const store = await SessionStore.create(join(dir, "ses.db"), join(dir, "transcripts"));
    try {
      const s = await store.createSession({ cwd: "/repo", model: "openai:test" });
      await store.appendMessage(s.id, { role: "user", content: "hello" });
      await store.appendMessage(s.id, { role: "assistant", content: "hi there" });
      await store.appendMessage(s.id, { role: "user", content: "second question" });

      const transcript = await store.readTranscript(s.id);
      expect(transcript.length).toBe(3);
      expect(transcript[0]!.content).toBe("hello");

      // usage accounting
      await store.addUsage(s.id, { inputTokens: 10, outputTokens: 5 });
      expect(store.get(s.id)!.inputTokens).toBe(10);

      // latest() picks the most recently updated
      expect(store.latest()!.id).toBe(s.id);

      // fork copies the transcript
      const fork = await store.fork(s.id);
      expect(fork!.parentId).toBe(s.id);
      expect((await store.readTranscript(fork!.id)).length).toBe(3);

      // rewind drops the tail
      const dropped = await store.rewind(s.id, 1);
      expect(dropped).toBe(1);
      expect((await store.readTranscript(s.id)).length).toBe(2);
    } finally {
      store.close();
    }
  });

  test("replaceTranscript keeps a runtime's full history from being appended twice", async () => {
    const store = await SessionStore.create(join(dir, "replace.db"), join(dir, "replace-transcripts"));
    try {
      const s = await store.createSession({ cwd: "/repo", model: "openai:test" });
      const firstTurn = [
        { role: "user" as const, content: "hello" },
        { role: "assistant" as const, content: "hi there" },
      ];

      await store.replaceTranscript(s.id, firstTurn);
      await store.replaceTranscript(s.id, [...firstTurn, { role: "user", content: "another question" }]);

      expect(await store.readTranscript(s.id)).toEqual([
        ...firstTurn,
        { role: "user", content: "another question" },
      ]);
    } finally {
      store.close();
    }
  });
});
