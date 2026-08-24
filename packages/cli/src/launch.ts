/**
 * Bun reads `bunfig.toml` from the current directory when the binary starts and
 * executes whatever its `preload` key names — before any of our code runs. For a
 * terminal agent that is a real hazard: running mosaic inside an untrusted
 * checkout would execute that repo's code in-process, next to the provider
 * tokens mosaic has stored.
 *
 * The launcher script installed as `mosaic` therefore starts the binary from a
 * directory containing nothing but the binary, and passes the user's real
 * working directory in MOSAIC_CWD. Bun's startup is over by the time this runs,
 * so moving back is safe.
 */
export function restoreLaunchCwd(
  env: NodeJS.ProcessEnv = process.env,
  chdir: (dir: string) => void = process.chdir,
): void {
  const launchCwd = env.MOSAIC_CWD;
  if (!launchCwd) return;
  // Never let it reach a child process: tools inherit the environment, and a
  // stale MOSAIC_CWD would silently redirect a nested mosaic invocation. Drop it
  // before the chdir so it is gone on the failure path too.
  delete env.MOSAIC_CWD;
  try {
    chdir(launchCwd);
  } catch (cause) {
    throw new Error(`cannot enter working directory: ${launchCwd}`, { cause });
  }
}
