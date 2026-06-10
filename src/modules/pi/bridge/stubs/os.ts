import { piEnv } from "../pi-env";

// Browser shim for node:os.
// Pi SDK uses tmpdir(), homedir(), platform().

export function tmpdir(): string {
  return piEnv.tmpdir;
}

export function homedir(): string {
  return piEnv.homeDir;
}

export function platform(): string {
  return piEnv.platform;
}

export const EOL = piEnv.platform === "win32" ? "\r\n" : "\n";

export default { tmpdir, homedir, platform, EOL };
