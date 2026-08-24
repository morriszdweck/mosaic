import { describe, expect, test } from "bun:test";
import { restoreLaunchCwd } from "../src/launch.ts";

describe("restoreLaunchCwd", () => {
  test("returns to the directory the launcher was invoked from", () => {
    const env = { MOSAIC_CWD: "/Users/someone/project" } as NodeJS.ProcessEnv;
    const seen: string[] = [];
    restoreLaunchCwd(env, (dir) => seen.push(dir));
    expect(seen).toEqual(["/Users/someone/project"]);
  });

  // A child process inheriting MOSAIC_CWD would chdir a nested mosaic to a
  // directory the user never asked for.
  test("removes MOSAIC_CWD so children do not inherit it", () => {
    const env = { MOSAIC_CWD: "/tmp/x", OTHER: "keep" } as NodeJS.ProcessEnv;
    restoreLaunchCwd(env, () => {});
    expect(env.MOSAIC_CWD).toBeUndefined();
    expect(env.OTHER).toBe("keep");
  });

  test("does nothing when launched without the wrapper", () => {
    const env = {} as NodeJS.ProcessEnv;
    let called = false;
    restoreLaunchCwd(env, () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test("ignores an empty MOSAIC_CWD rather than chdir'ing to nowhere", () => {
    const env = { MOSAIC_CWD: "" } as NodeJS.ProcessEnv;
    let called = false;
    restoreLaunchCwd(env, () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test("reports the unreachable directory by name", () => {
    const env = { MOSAIC_CWD: "/nope/gone" } as NodeJS.ProcessEnv;
    expect(() =>
      restoreLaunchCwd(env, () => {
        throw new Error("ENOENT");
      }),
    ).toThrow("cannot enter working directory: /nope/gone");
  });

  // The variable is dropped before the chdir, so the failure path cannot leak it
  // into the environment either.
  test("removes MOSAIC_CWD even when the chdir fails", () => {
    const env = { MOSAIC_CWD: "/nope/gone" } as NodeJS.ProcessEnv;
    try {
      restoreLaunchCwd(env, () => {
        throw new Error("ENOENT");
      });
    } catch {
      // expected
    }
    expect(env.MOSAIC_CWD).toBeUndefined();
  });
});
