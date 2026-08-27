import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Mosaic provider launcher", () => {
  test("brands provider help as Mosaic", () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-launcher-"));
    const binDir = join(root, "bin");
    const sourceDir = join(root, "src");
    const engineDir = join(root, "node_modules", ".bin");
    const home = join(root, "home");

    try {
      mkdirSync(binDir, { recursive: true });
      mkdirSync(sourceDir, { recursive: true });
      mkdirSync(engineDir, { recursive: true });
      writeFileSync(
        join(binDir, "mosaic"),
        readFileSync(new URL("../bin/mosaic", import.meta.url)),
        { mode: 0o755 },
      );
      writeFileSync(join(sourceDir, "config.ts"), "");
      writeFileSync(join(sourceDir, "swarm.ts"), "");
      writeFileSync(
        join(engineDir, "opencode"),
        "#!/usr/bin/env bash\nprintf '%s\\n' 'opencode providers' '  opencode providers list' 'Credentials data/opencode/auth.json' >&2\n",
        { mode: 0o755 },
      );
      chmodSync(join(binDir, "mosaic"), 0o755);
      chmodSync(join(engineDir, "opencode"), 0o755);

      const result = spawnSync("bash", [join(binDir, "mosaic"), "providers", "--help"], {
        encoding: "utf8",
        env: { ...process.env, MOSAIC_HOME: home },
      });
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(0);
      expect(output).toContain("mosaic providers");
      expect(output).not.toContain("opencode providers");
      expect(output).toContain("data/opencode/auth.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("routes the plural alias to OpenCode's native plugin installer", () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-launcher-"));
    const binDir = join(root, "bin");
    const sourceDir = join(root, "src");
    const engineDir = join(root, "node_modules", ".bin");
    const home = join(root, "home");

    try {
      mkdirSync(binDir, { recursive: true });
      mkdirSync(sourceDir, { recursive: true });
      mkdirSync(engineDir, { recursive: true });
      writeFileSync(
        join(binDir, "mosaic"),
        readFileSync(new URL("../bin/mosaic", import.meta.url)),
        { mode: 0o755 },
      );
      writeFileSync(join(sourceDir, "config.ts"), "");
      writeFileSync(join(sourceDir, "swarm.ts"), "");
      writeFileSync(
        join(engineDir, "opencode"),
        "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n",
        { mode: 0o755 },
      );
      chmodSync(join(binDir, "mosaic"), 0o755);
      chmodSync(join(engineDir, "opencode"), 0o755);

      const result = spawnSync("bash", [join(binDir, "mosaic"), "plugins", "install", "example-plugin"], {
        encoding: "utf8",
        env: { ...process.env, MOSAIC_HOME: home },
      });
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(0);
      expect(output).toContain("plugin");
      expect(output).toContain("example-plugin");
      expect(output).toContain("--global");
      expect(output).not.toContain("install");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
