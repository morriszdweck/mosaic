import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig } from "../src/config.ts";
import { defaultPaths, syncSwarm } from "../src/swarm.ts";

const browserCommand = buildConfig("/opt/mosaic", "/home/u/.mosaic").command?.browser;

describe("browser setup command", () => {
  test("registers a WebBridge health check", () => {
    expect(browserCommand).toBeDefined();
    const serializedCommand = JSON.stringify(browserCommand ?? {});
    expect(serializedCommand).toContain("kimi-webbridge status");
    expect(serializedCommand).toContain("chromewebstore.google.com/detail/kimi-webbridge");
  });
});

describe("bundled Kimi WebBridge skill", () => {
  test("syncs the skill into Mosaic's engine skill directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-browser-root-"));
    const home = mkdtempSync(join(tmpdir(), "mosaic-browser-home-"));
    try {
      mkdirSync(join(root, "agents"));
      mkdirSync(join(root, "skills", "kimi-webbridge"), { recursive: true });
      writeFileSync(
        join(root, "skills", "kimi-webbridge", "SKILL.md"),
        await Bun.file(new URL("../skills/kimi-webbridge/SKILL.md", import.meta.url)).text(),
      );

      const paths = defaultPaths(root, home);
      const result = await syncSwarm(paths);

      expect(result.installed).toContain("kimi-webbridge");
      const installedSkill = readFileSync(
        join(home, "config", "opencode", "skill", "kimi-webbridge", "SKILL.md"),
        "utf8",
      );
      expect(installedSkill).toContain("name: kimi-webbridge");
      expect(installedSkill).toContain("kimi-webbridge status");
      expect(installedSkill).toContain(
        "https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
