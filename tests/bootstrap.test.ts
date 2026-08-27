import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Mosaic bootstrap launcher", () => {
  test("updates from the official installer before launching Mosaic", () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-bootstrap-"));
    const binDir = join(root, "bin");
    const fakeBinDir = join(root, "fake-bin");
    const updateMarker = join(root, "updated");
    const argsMarker = join(root, "args");
    const curlMarker = join(root, "curl-args");
    try {
      mkdirSync(binDir);
      mkdirSync(fakeBinDir);
      writeFileSync(
        join(binDir, "mosaic-bootstrap"),
        readFileSync(new URL("../bin/mosaic-bootstrap", import.meta.url)),
        { mode: 0o755 },
      );
      writeFileSync(
        join(binDir, "mosaic"),
        '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$MOSAIC_TEST_ARGS"\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(fakeBinDir, "curl"),
        '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$MOSAIC_TEST_CURL_ARGS"\nprintf \'%s\\n\' \'printf "updated" > "$MOSAIC_TEST_UPDATED"\'\n',
        { mode: 0o755 },
      );
      chmodSync(join(binDir, "mosaic-bootstrap"), 0o755);
      chmodSync(join(binDir, "mosaic"), 0o755);
      chmodSync(join(fakeBinDir, "curl"), 0o755);

      const result = spawnSync("bash", [join(binDir, "mosaic-bootstrap"), "run", "research"], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOSAIC_TEST_ARGS: argsMarker,
          MOSAIC_TEST_CURL_ARGS: curlMarker,
          MOSAIC_TEST_UPDATED: updateMarker,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("mosaic: checking for updates...\n");
      expect(readFileSync(updateMarker, "utf8")).toBe("updated");
      expect(readFileSync(argsMarker, "utf8")).toBe("run research\n");
      expect(readFileSync(curlMarker, "utf8")).toContain(
        "https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("starts the existing install when the update fails", () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-bootstrap-"));
    const binDir = join(root, "bin");
    const fakeBinDir = join(root, "fake-bin");
    const argsMarker = join(root, "args");
    const curlMarker = join(root, "curl-args");
    try {
      mkdirSync(binDir);
      mkdirSync(fakeBinDir);
      writeFileSync(
        join(binDir, "mosaic-bootstrap"),
        readFileSync(new URL("../bin/mosaic-bootstrap", import.meta.url)),
        { mode: 0o755 },
      );
      writeFileSync(
        join(binDir, "mosaic"),
        '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$MOSAIC_TEST_ARGS"\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(fakeBinDir, "curl"),
        '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$MOSAIC_TEST_CURL_ARGS"\nexit 1\n',
        { mode: 0o755 },
      );
      chmodSync(join(binDir, "mosaic-bootstrap"), 0o755);
      chmodSync(join(binDir, "mosaic"), 0o755);
      chmodSync(join(fakeBinDir, "curl"), 0o755);

      const result = spawnSync("bash", [join(binDir, "mosaic-bootstrap"), "status"], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOSAIC_TEST_ARGS: argsMarker,
          MOSAIC_TEST_CURL_ARGS: curlMarker,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("mosaic: checking for updates...\n");
      expect(readFileSync(argsMarker, "utf8")).toBe("status\n");
      expect(readFileSync(curlMarker, "utf8")).toContain("raw.githubusercontent.com");
      expect(result.stderr).toContain("starting the existing install");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
