import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

/**
 * Registering Mosaic with the operating system's scheduler.
 *
 * A standalone task has to fire when Mosaic is not running, which means
 * something outside Mosaic has to start it. That is what the OS scheduler is
 * for, and it is the only part of this feature that cannot be done in-process.
 *
 * One entry is registered, not one per task: it wakes every minute, asks the
 * task database what is due, and exits. Adding a task therefore never touches
 * the OS, so a scheduler that a user has locked down does not have to be
 * negotiated with again on every `schedule add`.
 *
 * The entry is installed the first time a standalone task is created, so the
 * feature works without a setup step — and if it cannot be installed, that is
 * reported rather than swallowed, because the alternative is a task that
 * silently never runs.
 */

export const LABEL = "com.mosaic.tasks";
/** Marks Mosaic's line in a crontab so it can be replaced and removed. */
export const CRON_MARKER = "# mosaic-tasks";

export type Method = "launchd" | "systemd" | "cron" | "none";

export interface InstallResult {
  ok: boolean;
  method: Method;
  message: string;
}

function root(): string {
  return process.env.MOSAIC_ROOT ?? join(import.meta.dir, "..", "..", "..");
}

function mosaicHome(): string {
  return process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
}

function launcher(): string {
  return join(root(), "bin", "mosaic");
}

function logFile(): string {
  const path = join(mosaicHome(), "logs", "tasks.log");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

/**
 * A PATH the scheduler's own environment will not have.
 *
 * launchd and cron start with a minimal PATH that does not include Bun, and
 * `bin/mosaic` is a bash script that runs `bun`. This is the failure everyone
 * hits once: the entry installs, fires on time, and dies with "bun: command not
 * found" where nobody is watching. The directory Bun is running from now is the
 * one that will work later.
 */
function schedulerPath(): string {
  const dirs = [
    dirname(process.execPath),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(dirs)].join(":");
}

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

/** systemd reads from the real ~/.config, which the launcher's XDG override moves. */
function systemdDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

function run(command: string, args: string[], input?: string) {
  return spawnSync(command, args, { encoding: "utf8", input });
}

function has(command: string): boolean {
  return run("which", [command]).status === 0;
}

/**
 * Which scheduler to register with.
 *
 * `MOSAIC_TASKS_SCHEDULER` overrides the choice, including `none` for anyone
 * who would rather wire `mosaic tasks run-due` into their own cron or CI and
 * not have Mosaic touch launchd or crontab at all.
 */
export function currentMethod(): Method {
  const override = process.env.MOSAIC_TASKS_SCHEDULER as Method | undefined;
  if (override && ["launchd", "systemd", "cron", "none"].includes(override)) return override;
  if (platform() === "darwin") return "launchd";
  if (platform() === "linux") return has("systemctl") ? "systemd" : has("crontab") ? "cron" : "none";
  return has("crontab") ? "cron" : "none";
}

export function isInstalled(): boolean {
  switch (currentMethod()) {
    case "launchd":
      return existsSync(plistPath());
    case "systemd":
      return existsSync(join(systemdDir(), "mosaic-tasks.timer"));
    case "cron":
      return readCrontab().includes(CRON_MARKER);
    default:
      return false;
  }
}

/** Idempotent: installing over an existing entry replaces it. */
export function install(): InstallResult {
  switch (currentMethod()) {
    case "launchd":
      return installLaunchd();
    case "systemd":
      return installSystemd();
    case "cron":
      return installCron();
    default:
      return {
        ok: false,
        method: "none",
        message: `No supported scheduler found. Run this yourself every minute: ${launcher()} tasks run-due`,
      };
  }
}

export function uninstall(): InstallResult {
  switch (currentMethod()) {
    case "launchd": {
      const path = plistPath();
      run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${LABEL}`]);
      rmSync(path, { force: true });
      return { ok: true, method: "launchd", message: "Removed the launchd agent. Standalone tasks will not fire." };
    }
    case "systemd": {
      run("systemctl", ["--user", "disable", "--now", "mosaic-tasks.timer"]);
      rmSync(join(systemdDir(), "mosaic-tasks.timer"), { force: true });
      rmSync(join(systemdDir(), "mosaic-tasks.service"), { force: true });
      run("systemctl", ["--user", "daemon-reload"]);
      return { ok: true, method: "systemd", message: "Removed the systemd timer. Standalone tasks will not fire." };
    }
    case "cron": {
      writeCrontab(stripMosaic(readCrontab()));
      return { ok: true, method: "cron", message: "Removed the crontab entry. Standalone tasks will not fire." };
    }
    default:
      return { ok: true, method: "none", message: "Nothing was installed." };
  }
}

function installLaunchd(): InstallResult {
  const path = plistPath();
  mkdirSync(dirname(path), { recursive: true });
  const log = logFile();
  // RunAtLoad catches a task whose time passed while the machine was off: the
  // agent is loaded at login, checks once, and the run happens late instead of
  // not at all.
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${launcher()}</string>
    <string>tasks</string>
    <string>run-due</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${schedulerPath()}</string>
    <key>MOSAIC_HOME</key><string>${mosaicHome()}</string>
    <key>MOSAIC_ROOT</key><string>${root()}</string>
  </dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`,
  );

  const target = `gui/${process.getuid?.() ?? 501}`;
  run("launchctl", ["bootout", `${target}/${LABEL}`]);
  const loaded = run("launchctl", ["bootstrap", target, path]);
  if (loaded.status !== 0) {
    // Older macOS, and the form that still works when bootstrap refuses.
    const legacy = run("launchctl", ["load", "-w", path]);
    if (legacy.status !== 0) {
      return {
        ok: false,
        method: "launchd",
        message: `Wrote ${path} but launchctl refused to load it: ${(loaded.stderr || legacy.stderr || "").trim()}`,
      };
    }
  }
  return { ok: true, method: "launchd", message: `Installed a launchd agent (${path}), checking every minute.` };
}

function installSystemd(): InstallResult {
  const dir = systemdDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "mosaic-tasks.service"),
    `[Unit]
Description=Mosaic scheduled tasks

[Service]
Type=oneshot
Environment=PATH=${schedulerPath()}
Environment=MOSAIC_HOME=${mosaicHome()}
Environment=MOSAIC_ROOT=${root()}
ExecStart=${launcher()} tasks run-due
`,
  );
  // Persistent catches up a run missed while the machine was off, once.
  writeFileSync(
    join(dir, "mosaic-tasks.timer"),
    `[Unit]
Description=Mosaic scheduled tasks

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
`,
  );
  run("systemctl", ["--user", "daemon-reload"]);
  const enabled = run("systemctl", ["--user", "enable", "--now", "mosaic-tasks.timer"]);
  if (enabled.status !== 0) {
    return {
      ok: false,
      method: "systemd",
      message: `Wrote the timer but systemctl refused it: ${(enabled.stderr || "").trim()}`,
    };
  }
  return {
    ok: true,
    method: "systemd",
    message:
      "Installed a systemd user timer, checking every minute. " +
      "For tasks to run while you are logged out, enable lingering: " +
      `loginctl enable-linger ${process.env.USER ?? "$USER"}`,
  };
}

function installCron(): InstallResult {
  const line = `* * * * * PATH=${schedulerPath()} MOSAIC_HOME=${mosaicHome()} MOSAIC_ROOT=${root()} ${launcher()} tasks run-due >> ${logFile()} 2>&1 ${CRON_MARKER}`;
  const next = [...stripMosaic(readCrontab()), line].join("\n");
  const written = writeCrontab(next.split("\n"));
  if (!written) return { ok: false, method: "cron", message: "crontab refused the entry." };
  return { ok: true, method: "cron", message: "Installed a crontab entry, checking every minute." };
}

function readCrontab(): string[] {
  const result = run("crontab", ["-l"]);
  if (result.status !== 0) return [];
  return result.stdout.split("\n");
}

function stripMosaic(lines: string[]): string[] {
  return lines.filter((line) => line.trim() && !line.includes(CRON_MARKER));
}

function writeCrontab(lines: string[]): boolean {
  const body = `${lines.filter((line) => line.trim()).join("\n")}\n`;
  return run("crontab", ["-"], body).status === 0;
}
