#!/usr/bin/env bun
import { parseArgs, HELP } from "./args.ts";
import { loginCommand, logoutCommand, authStatusCommand } from "./commands/auth.ts";
import { sessionsCommand } from "./commands/sessions.ts";
import { headless } from "./headless.ts";

export const VERSION = "0.1.0";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.flags.cwd ?? process.cwd();

  if (args.flags.version) {
    console.log(`mosaic ${VERSION}`);
    return 0;
  }
  if (args.flags.help) {
    console.log(HELP);
    return 0;
  }

  switch (args.command) {
    case "login":
      return loginCommand(args.positional[0], { key: args.flags.key });
    case "logout":
      return logoutCommand(args.positional[0]);
    case "auth":
      if (args.positional[0] === "status") return authStatusCommand();
      console.error("Usage: mosaic auth status");
      return 1;
    case "sessions":
      return sessionsCommand();
    case "print": // alias for -p
      args.flags.print = true;
      break;
  }

  if (args.flags.print) {
    const prompt = args.positional.join(" ") || (args.command && !["print"].includes(args.command) ? args.command : "");
    if (!prompt) {
      console.error("Headless mode needs a prompt: mosaic -p \"your prompt\"");
      return 1;
    }
    return headless({
      prompt,
      cwd,
      model: args.flags.model,
      resume: args.flags.resume,
      continueSession: args.flags.continueSession,
    });
  }

  // Default: launch the TUI.
  const { startTui } = await import("@mosaic/tui");
  return startTui({
    cwd,
    model: args.flags.model,
    resume: args.flags.resume,
    continueSession: args.flags.continueSession,
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
