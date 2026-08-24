/**
 * Hand-rolled argument parsing — zero dependencies, predictable behavior.
 */

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: {
    print: boolean; // -p / --print: headless mode
    model?: string; // -m / --model
    resume?: string; // --resume <id>
    continueSession: boolean; // -c / --continue
    cwd?: string; // --cwd
    key?: string; // login --key
    version: boolean;
    help: boolean;
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: null,
    positional: [],
    flags: { print: false, continueSession: false, version: false, help: false },
  };

  const args = [...argv];
  // First bare word may be a command.
  if (args[0] && !args[0].startsWith("-")) {
    out.command = args.shift()!;
  }

  while (args.length) {
    const arg = args.shift()!;
    switch (arg) {
      case "-p":
      case "--print":
        out.flags.print = true;
        break;
      case "-m":
      case "--model":
        out.flags.model = args.shift();
        break;
      case "-c":
      case "--continue":
        out.flags.continueSession = true;
        break;
      case "--resume":
        out.flags.resume = args.shift();
        break;
      case "--cwd":
        out.flags.cwd = args.shift();
        break;
      case "--key":
        out.flags.key = args.shift();
        break;
      case "-v":
      case "--version":
        out.flags.version = true;
        break;
      case "-h":
      case "--help":
        out.flags.help = true;
        break;
      default:
        if (arg.startsWith("--model=")) out.flags.model = arg.slice(8);
        else if (arg.startsWith("--resume=")) out.flags.resume = arg.slice(9);
        else if (arg.startsWith("--cwd=")) out.flags.cwd = arg.slice(6);
        else out.positional.push(arg);
    }
  }
  return out;
}

export const HELP = `mosaic — a terminal AI agent

Usage:
  mosaic                      Start the interactive TUI
  mosaic -p "<prompt>"        Headless mode: run one prompt and print the result
  mosaic -c                   Continue the most recent session
  mosaic --resume <id>        Resume a specific session
  mosaic sessions             List recent sessions
  mosaic login [provider]     Sign in: codex (device flow), opencode (paste key), or any provider key
  mosaic logout [provider]    Remove stored credentials
  mosaic auth status          Show which providers are configured
  mosaic --version            Print version

Flags:
  -m, --model <ref>           Model as provider:model (e.g. anthropic:claude-sonnet-4-5, ollama:llama3.1)
  --cwd <dir>                 Working directory (default: current)

Config:   ~/.mosaic/config.toml (optional — sensible defaults, no file required)
Auth:     ~/.mosaic/auth.json (0600)
Docs:     https://github.com/morriszdweck/mosaic
`;
