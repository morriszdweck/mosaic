/**
 * Build script: compiles Mosaic to a single binary.
 * The Solid JSX transform must be registered as a build plugin (bunfig
 * preload only covers `bun run`, not `bun build`).
 *
 * Usage: bun run build.ts [--outfile path] [--target bun-<os>-<arch>]
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const outfileIdx = process.argv.indexOf("--outfile");
const outfile = outfileIdx >= 0 ? process.argv[outfileIdx + 1] : "../../mosaic";
// Optional cross-compile target (e.g. bun-darwin-arm64); defaults to the host.
const targetIdx = process.argv.indexOf("--target");
const target = targetIdx >= 0 ? process.argv[targetIdx + 1] : undefined;

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  plugins: [solidPlugin],
  // `as never`: bun-types lag the runtime, which accepts a target string here.
  compile: target ? { outfile, target: target as never } : { outfile },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${outfile}${target ? ` (${target})` : ""}`);
