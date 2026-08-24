import { homedir } from "node:os";
import { join } from "node:path";

/** Centralized path helpers. Everything lives under ~/.mosaic by default. */

export function mosaicHome(): string {
  return process.env.MOSAIC_HOME ?? join(homedir(), ".mosaic");
}

export function configPath(): string {
  return join(mosaicHome(), "config.toml");
}

export function authPath(): string {
  return join(mosaicHome(), "auth.json");
}

export function dbPath(): string {
  return join(mosaicHome(), "mosaic.db");
}

export function sessionsDir(): string {
  return join(mosaicHome(), "sessions");
}

export function skillsDirs(cwd: string): string[] {
  return [join(mosaicHome(), "skills"), join(cwd, ".mosaic", "skills")];
}

export function projectConfigDir(cwd: string): string {
  return join(cwd, ".mosaic");
}

export async function ensureDir(path: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
