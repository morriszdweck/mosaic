---
name: plugin-creator
description: Use when the user asks to create, package, publish, or install a Mosaic plugin. Covers the Mosaic plugin manifest, OpenCode-compatible tool entrypoints, bundled skills, GitHub layout, and the copyable Install with Mosaic prompt.
---

# Mosaic Plugin Creator

A Mosaic plugin is a small GitHub repository that bundles a capability into one
installable package. It can contain skills, tools, or both:

```text
my-plugin/
├── mosaic-plugin.json
├── README.md
├── plugin.ts                 # optional tool entrypoint
└── skills/
    └── my-skill/
        └── SKILL.md
```

## Manifest

Create `mosaic-plugin.json` at the repository root:

```json
{
  "name": "lowercase-with-hyphens",
  "version": "0.1.0",
  "description": "One sentence describing the capability",
  "entry": "plugin.ts",
  "skills": ["skills/my-skill"]
}
```

`entry` is optional. It points to a TypeScript module exporting an OpenCode
server plugin. `skills` is optional. Each listed directory must contain a
`SKILL.md` with valid skill frontmatter. A package must provide at least one of
them.

Tool plugins that import `@opencode-ai/plugin` should include a `package.json`
with that dependency. Mosaic runs `bun install --production` while installing
the package. Keep tool code small, typed, and narrowly scoped to the purpose of
the plugin.

## Create a plugin

When the user asks for a plugin:

1. Clarify the one job it should do and choose a lowercase hyphenated name.
2. Create the manifest and the smallest useful skill and/or tool entrypoint.
3. Write a README explaining the purpose, file layout, and one example.
4. Add an **Install with Mosaic** section containing a prompt the user can copy:

   ```text
   Install this Mosaic plugin from https://github.com/OWNER/REPOSITORY.
   Run `mosaic plugins install https://github.com/OWNER/REPOSITORY`, inspect the
   manifest and installation result, then tell me to restart Mosaic.
   ```

5. If the user asked to publish it, create or use the requested GitHub
   repository and commit the package contents there.

Do not call a package an OpenCode plugin in its user-facing documentation. The
tool entrypoint uses OpenCode's runtime contract, but the package format and
install workflow are Mosaic's.

## Install a plugin

The preferred workflow is intentionally copyable. Open the plugin's GitHub
repository, copy its **Install with Mosaic** prompt, and paste it into Mosaic.
The agent should run:

```sh
mosaic plugins install https://github.com/OWNER/REPOSITORY
```

The installer accepts GitHub repository URLs or `OWNER/REPOSITORY`, validates
the manifest, installs tool dependencies when needed, and keeps the package
under `~/.mosaic/plugins`. Skills are synced into Mosaic's own skill directory
and tool entrypoints are loaded from the generated Mosaic config. Restart after
installation. Only install repositories the user trusts: tool entrypoints and
dependency installation can execute code on their machine.

Use `mosaic plugins list` to see installed packages. Never copy a plugin into
`~/.config/opencode`; that directory belongs to a separate OpenCode install.
