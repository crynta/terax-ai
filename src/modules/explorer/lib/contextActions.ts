import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { IS_WINDOWS } from "@/lib/platform";

/** Characters a POSIX shell treats as syntax when a path is pasted unquoted. */
const POSIX_SHELL_SPECIAL = /([\\\s"'$`!&;|<>()[\]{}*?#~])/g;
/** Characters cmd/PowerShell treat as syntax when a path is pasted unquoted. */
const WINDOWS_SHELL_SPECIAL = /[\s"&|<>^%()]/;

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort; ignore in environments without clipboard permission.
  }
}

/**
 * Neutralize shell syntax in a path so it survives a paste into the terminal
 * as a single argument (`My Folder` would otherwise split into two).
 * POSIX shells take a backslash escape; Windows treats `\` as a separator, so
 * quote there instead.
 */
export function escapeForShell(
  path: string,
  isWindows: boolean = IS_WINDOWS,
): string {
  if (!path) return path;
  if (isWindows) {
    return WINDOWS_SHELL_SPECIAL.test(path) ? `"${path}"` : path;
  }
  return path.replace(POSIX_SHELL_SPECIAL, "\\$1");
}

/** Copy a path in a form that pastes into the terminal as typed. */
export async function copyPathToClipboard(path: string): Promise<void> {
  await copyToClipboard(escapeForShell(path));
}

export function relativePath(rootPath: string, path: string): string {
  if (path === rootPath) return ".";
  if (path.startsWith(`${rootPath}/`)) return path.slice(rootPath.length + 1);
  return path;
}

export async function revealInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (e) {
    console.error("revealItemInDir failed:", e);
  }
}
