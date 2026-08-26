import { installPlugin, installedPlugins, syncPluginSkills } from "./plugin/package.ts";

export const PLUGINS_COMMAND = {
  plugins: {
    description: "Create or install Mosaic plugins from GitHub.",
    template: [
      "Give the user Mosaic's plugin guide.",
      "",
      "A Mosaic plugin is one GitHub repository containing mosaic-plugin.json, optional plugin.ts tool code, and optional skills/<name>/SKILL.md folders.",
      "",
      "To create one, offer to load the built-in plugin-creator skill. It can scaffold the manifest, tool entrypoint, skills, README, and a copyable installation prompt.",
      "",
      "To install one, tell the user to open its GitHub repository, copy the repository's 'Install with Mosaic' prompt, and paste it back into Mosaic. The prompt should ask Mosaic to run: mosaic plugins install <github-url>. The CLI also works directly: mosaic plugins install <github-url>.",
      "",
      "Only install repositories you trust: tool entrypoints and dependency installation can execute code on your machine.",
      "",
      "Installed packages live under ~/.mosaic/plugins. Mosaic loads their tools and syncs their skills on the next start. Use mosaic plugins list to inspect what is installed, and restart Mosaic after installing.",
      "",
      "Do not describe a Mosaic plugin as an OpenCode plugin. It uses OpenCode's tool runtime underneath, but the package format, install location, and user workflow belong to Mosaic.",
    ].join("\n"),
  },
} as const;

function printHelp(): void {
  process.stdout.write([
    "Mosaic plugins",
    "",
    "  mosaic plugins list",
    "  mosaic plugins install https://github.com/owner/plugin",
    "",
    "A plugin is a GitHub package of Mosaic skills and optional tools.",
    "Only install repositories you trust: tools and dependencies can execute code.",
    "You can also open a plugin repository, copy its Install with Mosaic prompt,",
    "and paste that prompt into an agent. Restart Mosaic after installing.",
    "",
  ].join("\n"));
}

if (import.meta.main) {
  const action = process.argv[2] ?? "help";
  if (action === "sync") {
    const result = await syncPluginSkills();
    if (result.skipped.length) process.stderr.write(`mosaic: skipped ${result.skipped.join(", ")}\n`);
  } else if (action === "list") {
    const plugins = installedPlugins();
    process.stdout.write(plugins.length ? plugins.map((plugin) => `${plugin.manifest.name} ${plugin.manifest.version} — ${plugin.manifest.description}`).join("\n") + "\n" : "No Mosaic plugins installed.\n");
  } else if (action === "install") {
    const spec = process.argv[3];
    if (!spec) {
      printHelp();
      process.exitCode = 1;
    } else {
      const result = await installPlugin(spec);
      if (!result.ok) {
        process.stderr.write(`mosaic: ${result.message}\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write(`Installed ${result.manifest.name}. Restart Mosaic to load it.\n`);
      }
    }
  } else {
    printHelp();
  }
}
