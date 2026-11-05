import { IS_WINDOWS } from "@/lib/platform";
import { currentWorkspaceEnv } from "@/modules/workspace";

/**
 * True when the block command bar writes into a Windows shell. A WSL workspace
 * runs the distro's POSIX shell even on a Windows host, so escaping and word
 * tokenizing follow the workspace, not the host platform alone.
 */
export function usesWindowsShell(): boolean {
  return IS_WINDOWS && currentWorkspaceEnv().kind === "local";
}
