import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { githubRepository, installedPlugins, parsePluginManifest, pluginDirectory, resolvePluginPath, syncPluginSkills } from "../src/plugin/package.ts";

describe("Mosaic plugin manifests", () => {
  test("parses a package with tools and skills", () => {
    const result = parsePluginManifest({
      name: "example-plugin",
      version: "0.1.0",
      description: "An example plugin",
      entry: "plugin.ts",
      skills: ["skills/example"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entry).toBe("plugin.ts");
      expect(result.value.skills).toEqual(["skills/example"]);
    }
  });

  test("rejects a package with no capability", () => {
    expect(parsePluginManifest({ name: "empty", version: "0.1.0", description: "Empty" }).ok).toBe(false);
  });
});

describe("Mosaic plugin sources", () => {
  test("normalizes a GitHub repository URL", () => {
    expect(githubRepository("morriszdweck/example-plugin")).toEqual({
      ok: true,
      name: "example-plugin",
      url: "https://github.com/morriszdweck/example-plugin.git",
    });
  });

  test("keeps plugin paths inside their package", () => {
    expect(resolvePluginPath("/tmp/plugin", "skills/design")).toBe("/tmp/plugin/skills/design");
    expect(resolvePluginPath("/tmp/plugin", "../outside")).toBeUndefined();
  });

  test("syncs bundled skills into Mosaic's skill directory", async () => {
    const home = await mkdtemp("/tmp/mosaic-plugin-test-");
    const packageDirectory = join(pluginDirectory(home), "example-plugin");
    const skillDirectory = join(packageDirectory, "skills", "example");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "mosaic-plugin.json"), JSON.stringify({
      name: "example-plugin",
      version: "0.1.0",
      description: "An example plugin",
      skills: ["skills/example"],
    }));
    await writeFile(join(skillDirectory, "SKILL.md"), "---\nname: example\ndescription: Example\n---\n");

    try {
      expect(await syncPluginSkills(home)).toEqual({ synced: ["example-plugin/example"], skipped: [] });
      expect(await readFile(join(home, "config", "opencode", "skill", "example", "SKILL.md"), "utf8")).toContain("name: example");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("does not discover a package with a missing declared skill", async () => {
    const home = await mkdtemp("/tmp/mosaic-plugin-test-");
    const packageDirectory = join(pluginDirectory(home), "example-plugin");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "mosaic-plugin.json"), JSON.stringify({
      name: "example-plugin",
      version: "0.1.0",
      description: "An example plugin",
      skills: ["skills/missing"],
    }));

    try {
      expect(installedPlugins(home)).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("does not discover a package whose skill symlink leaves the package", async () => {
    const home = await mkdtemp("/tmp/mosaic-plugin-test-");
    const packageDirectory = join(pluginDirectory(home), "example-plugin");
    const outsideDirectory = join(home, "outside");
    await mkdir(join(packageDirectory, "skills"), { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(join(outsideDirectory, "SKILL.md"), "---\nname: outside\ndescription: Outside\n---\n");
    await symlink(outsideDirectory, join(packageDirectory, "skills", "linked"), "dir");
    await writeFile(join(packageDirectory, "mosaic-plugin.json"), JSON.stringify({
      name: "example-plugin",
      version: "0.1.0",
      description: "An example plugin",
      skills: ["skills/linked"],
    }));

    try {
      expect(installedPlugins(home)).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
