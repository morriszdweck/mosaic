import { describe, expect, test } from "bun:test";
import { isLeader, matchDirect, matchLeader } from "../src/keys.ts";

describe("leader key", () => {
  test("ctrl+x arms the leader", () => {
    expect(isLeader({ name: "x", ctrl: true })).toBe(true);
  });

  test("a bare x is just typing", () => {
    expect(isLeader({ name: "x" })).toBe(false);
  });

  test("leader chords map to actions", () => {
    expect(matchLeader({ name: "f" })).toBe("files");
    expect(matchLeader({ name: "s" })).toBe("sessions");
    expect(matchLeader({ name: "t" })).toBe("theme");
  });

  test("shift distinguishes top from bottom, as in vi", () => {
    expect(matchLeader({ name: "g" })).toBe("scroll-top");
    expect(matchLeader({ name: "g", shift: true })).toBe("scroll-bottom");
  });

  test("a modified key is not a leader chord", () => {
    expect(matchLeader({ name: "f", ctrl: true })).toBeNull();
  });

  test("an unbound key does nothing", () => {
    expect(matchLeader({ name: "z" })).toBeNull();
  });
});

describe("direct chords", () => {
  test("ctrl+p opens the palette", () => {
    expect(matchDirect({ name: "p", ctrl: true })).toBe("palette");
  });

  test("a bare p is not the palette — it has to be typeable", () => {
    expect(matchDirect({ name: "p" })).toBeNull();
  });

  test("escape cancels", () => {
    expect(matchDirect({ name: "escape" })).toBe("cancel");
  });

  test("page keys scroll", () => {
    expect(matchDirect({ name: "pageup" })).toBe("page-up");
    expect(matchDirect({ name: "pagedown" })).toBe("page-down");
  });
});
