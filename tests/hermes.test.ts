import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore } from "../src/plugin/checkpoint/store.ts";
import { hooksDir, loadHooks } from "../src/plugin/hooks/index.ts";
import { headersFor, loadPools, makeRotator } from "../src/plugin/keypool/index.ts";

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mosaic-hermes-"));
  cwd = mkdtempSync(join(tmpdir(), "mosaic-work-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("checkpoints", () => {
  test("restore puts a changed file back", async () => {
    const file = join(cwd, "a.txt");
    writeFileSync(file, "ORIGINAL");
    const store = new CheckpointStore(home);
    const cp = store.create("ses_1", "before edits");

    await store.capture(cp.id, file, cwd);
    writeFileSync(file, "MODIFIED");
    await store.restore(cp.id, cwd);

    expect(readFileSync(file, "utf8")).toBe("ORIGINAL");
    store.close();
  });

  // The point of a checkpoint is the state before the *first* change; a later
  // edit in the same turn must not overwrite that.
  test("a file is captured once, keeping its earliest state", async () => {
    const file = join(cwd, "a.txt");
    writeFileSync(file, "FIRST");
    const store = new CheckpointStore(home);
    const cp = store.create("ses_1", "x");

    expect(await store.capture(cp.id, file, cwd)).toBe(true);
    writeFileSync(file, "SECOND");
    expect(await store.capture(cp.id, file, cwd)).toBe(false);

    writeFileSync(file, "THIRD");
    await store.restore(cp.id, cwd);
    expect(readFileSync(file, "utf8")).toBe("FIRST");
    store.close();
  });

  test("a file created after the checkpoint is removed on restore", async () => {
    const file = join(cwd, "new.txt");
    const store = new CheckpointStore(home);
    const cp = store.create("ses_1", "x");

    await store.capture(cp.id, file, cwd); // captures "did not exist"
    writeFileSync(file, "CREATED");
    await store.restore(cp.id, cwd);

    expect(existsSync(file)).toBe(false);
    store.close();
  });

  test("checkpoints are listed newest first and scoped to their session", () => {
    const store = new CheckpointStore(home);
    store.create("ses_1", "one");
    const two = store.create("ses_1", "two");
    store.create("ses_2", "other");

    expect(store.list("ses_1").map((c) => c.label)).toEqual(["two", "one"]);
    expect(store.current("ses_1")?.id).toBe(two.id);
    expect(store.list("ses_2")).toHaveLength(1);
    store.close();
  });

  test("dropping one removes its files too", async () => {
    const file = join(cwd, "a.txt");
    writeFileSync(file, "x");
    const store = new CheckpointStore(home);
    const cp = store.create("ses_1", "x");
    await store.capture(cp.id, file, cwd);

    expect(await store.remove(cp.id)).toBe(true);
    expect(store.get(cp.id)).toBeNull();
    expect(await store.remove(cp.id)).toBe(false);
    store.close();
  });

  test("counts the files it holds", async () => {
    const store = new CheckpointStore(home);
    const cp = store.create("ses_1", "x");
    for (const name of ["a.txt", "b.txt"]) {
      writeFileSync(join(cwd, name), "x");
      await store.capture(cp.id, join(cwd, name), cwd);
    }
    expect(store.get(cp.id)?.files).toBe(2);
    store.close();
  });
});

describe("event hooks", () => {
  const write = (name: string, body: string) => {
    mkdirSync(join(home, "hooks"), { recursive: true });
    writeFileSync(join(home, "hooks", name), body);
  };

  test("loads modules from the hooks directory", async () => {
    write("a.ts", "export function beforeTool() {}\n");
    const hooks = await loadHooks(hooksDir(home));
    expect(hooks.map((h) => h.name)).toEqual(["a.ts"]);
    expect(typeof hooks[0]!.module.beforeTool).toBe("function");
  });

  test("no hooks directory is not an error", async () => {
    expect(await loadHooks(hooksDir(home))).toEqual([]);
  });

  // A broken hook is the user's own code; it must not take the turn with it.
  test("a module that fails to import is skipped, not fatal", async () => {
    write("broken.ts", "this is not valid typescript {{{\n");
    write("good.ts", "export function afterTool() {}\n");
    const hooks = await loadHooks(hooksDir(home));
    expect(hooks.map((h) => h.name)).toEqual(["good.ts"]);
  });

  test("a default export is accepted as well as named ones", async () => {
    write("d.ts", "export default { onMessage() {} }\n");
    const hooks = await loadHooks(hooksDir(home));
    expect(typeof hooks[0]!.module.onMessage).toBe("function");
  });

  test("deny is what a guardrail hook calls to refuse a tool", async () => {
    write(
      "guard.ts",
      `export function beforeTool({ tool, args, deny }) {
         if (tool === "bash" && String(args.command).includes("rm -rf /")) deny("blocked");
       }\n`,
    );
    const [hook] = await loadHooks(hooksDir(home));
    const denials: string[] = [];
    const deny = (reason: string) => void denials.push(reason);

    hook!.module.beforeTool!({ tool: "bash", sessionID: "s", args: { command: "rm -rf /" }, deny });
    expect(denials).toEqual(["blocked"]);

    hook!.module.beforeTool!({ tool: "bash", sessionID: "s", args: { command: "ls" }, deny });
    expect(denials).toEqual(["blocked"]);
  });
});

describe("credential pools", () => {
  const config = (body: unknown) => writeFileSync(join(home, "config.json"), JSON.stringify(body));

  test("reads pools from config.json", async () => {
    config({ keys: { anthropic: ["sk-a", "sk-b"] } });
    expect(await loadPools(home)).toEqual({ anthropic: ["sk-a", "sk-b"] });
  });

  test("a bare string is treated as a pool of one", async () => {
    config({ keys: { groq: "sk-only" } });
    expect(await loadPools(home)).toEqual({ groq: ["sk-only"] });
  });

  test("no keys configured means no pools and no interference", async () => {
    config({ model: "x" });
    expect(await loadPools(home)).toEqual({});
    expect(await loadPools(join(home, "nope"))).toEqual({});
  });

  test("rotates round-robin so load spreads instead of hammering one key", () => {
    const next = makeRotator({ anthropic: ["a", "b", "c"] });
    expect([1, 2, 3, 4].map(() => next("anthropic"))).toEqual(["a", "b", "c", "a"]);
  });

  test("a provider with no pool is left alone", () => {
    expect(makeRotator({ anthropic: ["a"] })("openai")).toBeUndefined();
  });

  test("keys travel in the header each provider expects", () => {
    expect(headersFor("anthropic", "k")).toEqual({ "x-api-key": "k" });
    expect(headersFor("openai", "k")).toEqual({ authorization: "Bearer k" });
    // Bearer is the sensible default for an OpenAI-compatible endpoint.
    expect(headersFor("something-new", "k")).toEqual({ authorization: "Bearer k" });
  });
});

describe("checkpoint scope", () => {
  test("listed by directory, so a new session can still undo", () => {
    const store = new CheckpointStore(home);
    // `mosaic run` opens a new session every invocation, so a session-scoped
    // undo could never reach the edit made a minute earlier.
    store.create("ses_1", "first run", cwd);
    store.create("ses_2", "second run", cwd);
    store.create("ses_3", "elsewhere", "/other/place");

    expect(store.listForDirectory(cwd).map((c) => c.label)).toEqual(["second run", "first run"]);
    expect(store.listForDirectory("/other/place")).toHaveLength(1);
    store.close();
  });

  test("a checkpoint from another directory is not restorable here", () => {
    const store = new CheckpointStore(home);
    const other = store.create("ses_1", "x", "/somewhere/else");
    expect(store.get(other.id)?.directory).toBe("/somewhere/else");
    expect(store.listForDirectory(cwd)).toHaveLength(0);
    store.close();
  });
});
