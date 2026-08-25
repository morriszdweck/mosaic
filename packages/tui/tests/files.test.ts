import { afterAll, beforeAll, expect, test, describe } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexFiles, invalidateFileIndex, readReference } from "../src/files.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mosaic-files-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(dir, "secret"), { recursive: true });
  await writeFile(join(dir, "README.md"), "# hi");
  await writeFile(join(dir, "src", "app.ts"), "export const a = 1;");
  await writeFile(join(dir, "node_modules", "pkg", "index.js"), "junk");
  await writeFile(join(dir, "secret", "keys.txt"), "shh");
  await writeFile(join(dir, ".gitignore"), "secret\n# a comment\n\n");
  await writeFile(join(dir, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
});

afterAll(async () => {
  invalidateFileIndex();
  await rm(dir, { recursive: true, force: true });
});

describe("indexFiles", () => {
  test("finds project files", async () => {
    const files = await indexFiles(dir, true);
    expect(files).toContain("README.md");
    expect(files).toContain(join("src", "app.ts"));
  });

  test("skips node_modules without being told to", async () => {
    const files = await indexFiles(dir, true);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  test("honours directory entries in .gitignore", async () => {
    const files = await indexFiles(dir, true);
    expect(files.some((f) => f.startsWith("secret"))).toBe(false);
  });

  test("shallower paths sort first, since they are likelier targets", async () => {
    const files = await indexFiles(dir, true);
    expect(files.indexOf("README.md")).toBeLessThan(files.indexOf(join("src", "app.ts")));
  });

  test("a symlinked directory cannot send the walk in a loop", async () => {
    const looped = await mkdtemp(join(tmpdir(), "mosaic-loop-"));
    await writeFile(join(looped, "a.txt"), "a");
    await symlink(looped, join(looped, "self"), "dir").catch(() => {});
    // The assertion is that this returns at all.
    expect(await indexFiles(looped, true)).toContain("a.txt");
    await rm(looped, { recursive: true, force: true });
  });
});

describe("readReference", () => {
  test("reads a text file", async () => {
    expect(await readReference(dir, "README.md")).toBe("# hi");
  });

  test("refuses a binary file rather than pasting bytes into the prompt", async () => {
    expect(await readReference(dir, "binary.bin")).toBeNull();
  });

  test("returns null for a missing path", async () => {
    expect(await readReference(dir, "nope.txt")).toBeNull();
  });

  test("returns null for a directory", async () => {
    expect(await readReference(dir, "src")).toBeNull();
  });
});
