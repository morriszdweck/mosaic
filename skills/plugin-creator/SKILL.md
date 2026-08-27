---
name: plugin-creator
description: Use when the user asks to create, package, publish, or install an OpenCode-native plugin for Mosaic. Covers package.json, native plugin entrypoints, bundled skills, OpenCode config, and GitHub or npm distribution.
---

# OpenCode Plugin Creator

Mosaic uses OpenCode's native plugin system. A plugin is a normal npm package
or local JavaScript/TypeScript module; there is no Mosaic-specific manifest,
installer, or package directory.

## Package layout

For a distributable plugin, use:

```text
my-plugin/
├── package.json
├── plugin.ts
├── README.md
└── skills/
    └── my-skill/
        └── SKILL.md
```

Create `package.json` as the plugin manifest:

```json
{
  "name": "opencode-example-plugin",
  "version": "0.1.0",
  "description": "One sentence describing the capability",
  "type": "module",
  "main": "./plugin.ts",
  "exports": "./plugin.ts",
  "dependencies": {
    "@opencode-ai/plugin": "^1.18.22"
  }
}
```

Use a package name with an `opencode-` prefix when publishing a general
plugin. Keep runtime imports in `dependencies`, and match the
`@opencode-ai/plugin` version to the OpenCode release being targeted.

## Native plugin entrypoint

Export a function of type `Plugin` that returns OpenCode hooks, tools, or both:

```ts
import type { Plugin } from "@opencode-ai/plugin";

export const ExamplePlugin: Plugin = async ({ client }) => {
  await client.app.log({
    body: { service: "example-plugin", level: "info", message: "Loaded" },
  });
  return {};
};

export default ExamplePlugin;
```

For a plugin that bundles skills, register the package's `skills/` directory
with OpenCode's native skill loader through the `config` hook:

```ts
import type { Config, Plugin } from "@opencode-ai/plugin";
import { fileURLToPath } from "node:url";

type ConfigWithSkills = Config & { skills?: { paths?: string[] } };
const skillsDirectory = fileURLToPath(new URL("./skills", import.meta.url));

const ExamplePlugin: Plugin = async () => ({
  config: async (config) => {
    const nativeConfig = config as ConfigWithSkills;
    nativeConfig.skills ??= {};
    nativeConfig.skills.paths ??= [];
    if (!nativeConfig.skills.paths.includes(skillsDirectory)) {
      nativeConfig.skills.paths.push(skillsDirectory);
    }
  },
});

export default ExamplePlugin;
```

Each bundled skill needs its own `SKILL.md` with valid frontmatter. Use a
unique lowercase hyphenated skill ID and do not shadow Mosaic's built-ins:
`agent-swarm`, `customize-mosaic`, `customize-opencode`, `mosaic-self`, and
`plugin-creator`.

## Create a plugin

When the user asks for a plugin:

1. Clarify the one job it should do and choose a unique package name.
2. Create `package.json` and the smallest useful native `plugin.ts`.
3. Add bundled skills under `skills/<skill-name>/SKILL.md` when the capability
   is primarily reusable instructions.
4. Write a README explaining the purpose, native entrypoint, files, and one
   example.
5. Add installation instructions using the native Mosaic command:

   ```text
   Install the OpenCode plugin package `opencode-example-plugin` in Mosaic with
   `mosaic plugin opencode-example-plugin --global`, then restart Mosaic.
   ```

If the package is only in GitHub and not yet published to npm, document the
Git-backed package spec:

```sh
mosaic plugin opencode-example-plugin@git+https://github.com/OWNER/REPOSITORY.git --global
```

If the user asked to publish it, create or use the requested GitHub repository
and commit the package contents there. Do not create `mosaic-plugin.json` or a
second installer.

## Install a plugin

The canonical command delegates to OpenCode's native plugin installer:

```sh
mosaic plugin <npm-package-or-git-spec> --global
```

`mosaic plugins install <npm-package-or-git-spec>` is retained only as a
compatibility alias and translates to the same native command. It does not
clone a repository, inspect a Mosaic manifest, or copy files into
`~/.mosaic/plugins`.

Alternatively, add a native package or local file to the `plugin` array in
`~/.mosaic/config.json`:

```json
{
  "plugin": ["opencode-example-plugin"]
}
```

OpenCode installs package dependencies into its own cache and loads local
plugins from its native config directories. Skills are loaded by the native
`skill` tool. Restart Mosaic after changing a plugin, its package spec, or a
bundled skill. Only install plugins the user trusts: plugin code and its
dependencies execute in the Mosaic process.
