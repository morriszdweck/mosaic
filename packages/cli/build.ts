/**
 * Build script: compiles Mosaic to a single binary.
 * The Solid JSX transform must be registered as a build plugin (bunfig
 * preload only covers `bun run`, not `bun build`).
 *
 * Usage: bun run build.ts [--outfile path]
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const outfileIdx = process.argv.indexOf("--outfile");
const outfile = outfileIdx >= 0 ? process.argv[outfileIdx + 1] : "../../mosaic";

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  plugins: [solidPlugin],
  compile: { outfile },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${outfile}`);
