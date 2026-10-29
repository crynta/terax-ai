import { escapeForShell } from "@/lib/shellQuote";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort; ignore in environments without clipboard permission.
  }
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
