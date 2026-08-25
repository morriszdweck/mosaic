/**
 * `mosaic heartbeat` — recurring agent wake-ups.
 *
 * Each tick runs `mosaic run` as a subprocess, which means a fresh agent with
 * no accumulated history. Cost per tick stays flat however long the job has
 * been running, and a wedged tick cannot take the scheduler down with it.
 */
import { formatInterval, JobStore, parseInterval, type Job } from "./store.ts";

const HELP = `mosaic heartbeat — run the agent on a schedule

  mosaic heartbeat add <name> --every <interval> --prompt <text> [options]
  mosaic heartbeat list
  mosaic heartbeat remove <name>
  mosaic heartbeat enable|disable <name>
  mosaic heartbeat tick            run everything that is due once, then exit
  mosaic heartbeat run             stay running and tick on schedule

Options for add:
  --every <interval>   90s, 30m, 2h, 1d. Minimum 60s.
  --prompt <text>      what the agent is asked on each tick
  --agent <name>       which agent runs it (default: mosaic)
  --cwd <path>         working directory (default: here)
  --max-runs <n>       stop after n runs (default: unlimited)

Each tick is a fresh run: the agent gets the prompt and its tools, not the
history of previous ticks. Write prompts that check state and act only if
needed — "if X is true, do Y, otherwise reply nothing to do".

  mosaic heartbeat add inbox --every 30m \\
    --prompt "Check ~/notes/inbox.md. If anything is unfiled, file it and say what moved."
`;

interface Flags {
  [key: string]: string | boolean | undefined;
}

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { positional, flags };
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Run one job. Returns a short status for the log.
 *
 * The engine is invoked through the same launcher the user runs, so a tick
 * sees exactly the config, agents, and memory an interactive session does.
 */
async function runJob(job: Job, launcher: string): Promise<string> {
  const proc = Bun.spawn([launcher, "run", "--agent", job.agent, job.prompt], {
    cwd: job.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MOSAIC_HEARTBEAT: job.name },
  });

  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  const tail = (out.trim() || err.trim()).split("\n").filter(Boolean).pop() ?? "";
  return code === 0 ? `ok: ${tail}`.slice(0, 200) : `failed (${code}): ${tail}`.slice(0, 200);
}

async function tick(store: JobStore, launcher: string, log: (s: string) => void): Promise<number> {
  const due = store.due();
  for (const job of due) {
    log(`[${new Date().toISOString()}] ${job.name} …`);
    let status: string;
    try {
      status = await runJob(job, launcher);
    } catch (error) {
      // One bad job must not stop the others or kill the daemon.
      status = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    store.recordRun(job.id, status);
    log(`[${new Date().toISOString()}] ${job.name} ${status}`);
  }
  return due.length;
}

export async function heartbeatCommand(argv: string[], launcher: string): Promise<number> {
  const { positional, flags } = parseFlags(argv);
  const sub = positional[0];
  const store = new JobStore();

  try {
    switch (sub) {
      case "add": {
        const name = positional[1];
        const every = str(flags, "every");
        const prompt = str(flags, "prompt");
        if (!name || !every || !prompt) {
          process.stderr.write("Usage: mosaic heartbeat add <name> --every <interval> --prompt <text>\n");
          return 1;
        }
        const job = store.add({
          name,
          prompt,
          interval: parseInterval(every),
          agent: str(flags, "agent"),
          cwd: str(flags, "cwd") ?? process.cwd(),
          maxRuns: str(flags, "max-runs") ? Number(str(flags, "max-runs")) : null,
        });
        console.log(`✓ ${job.name} — every ${formatInterval(job.interval)}, agent ${job.agent}`);
        console.log(`  ${job.cwd}`);
        console.log(`\nStart the scheduler with: mosaic heartbeat run`);
        return 0;
      }

      case "list": {
        const jobs = store.list();
        if (!jobs.length) {
          console.log("No heartbeat jobs. Add one with `mosaic heartbeat add`.");
          return 0;
        }
        for (const job of jobs) {
          const when = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "never";
          const cap = job.maxRuns === null ? "" : `/${job.maxRuns}`;
          console.log(
            `${job.enabled ? "●" : "○"} ${job.name}  every ${formatInterval(job.interval)}  ` +
              `${job.agent}  runs ${job.runs}${cap}  last ${when}`,
          );
          if (job.lastStatus) console.log(`    ${job.lastStatus}`);
        }
        return 0;
      }

      case "remove": {
        const name = positional[1];
        if (!name) return usage("remove <name>");
        console.log(store.remove(name) ? `✓ removed ${name}` : `No job "${name}"`);
        return store.get(name) ? 1 : 0;
      }

      case "enable":
      case "disable": {
        const name = positional[1];
        if (!name) return usage(`${sub} <name>`);
        const ok = store.setEnabled(name, sub === "enable");
        console.log(ok ? `✓ ${sub}d ${name}` : `No job "${name}"`);
        return ok ? 0 : 1;
      }

      case "tick": {
        const n = await tick(store, launcher, (s) => console.log(s));
        if (n === 0) console.log("Nothing due.");
        return 0;
      }

      case "run": {
        const jobs = store.list().filter((j) => j.enabled);
        console.log(`Heartbeat running — ${jobs.length} job(s). Ctrl+C to stop.`);
        let stop = false;
        const halt = () => {
          stop = true;
        };
        process.on("SIGINT", halt);
        process.on("SIGTERM", halt);
        while (!stop) {
          await tick(store, launcher, (s) => console.log(s));
          // Poll at the finest granularity a job can have, so a 60s job is not
          // delayed by a 1d job sharing the loop.
          await new Promise((r) => setTimeout(r, 15_000));
        }
        console.log("Heartbeat stopped.");
        return 0;
      }

      default:
        process.stdout.write(HELP);
        return sub === undefined || sub === "help" || sub === "--help" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`mosaic heartbeat: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    store.close();
  }
}

function usage(rest: string): number {
  process.stderr.write(`Usage: mosaic heartbeat ${rest}\n`);
  return 1;
}

if (import.meta.main) {
  process.exit(await heartbeatCommand(process.argv.slice(2), process.env.MOSAIC_LAUNCHER ?? "mosaic"));
}
