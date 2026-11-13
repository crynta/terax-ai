import { usePreferencesStore } from "@/modules/settings/preferences";

export type ToolContext = {
  /** Active terminal tab cwd, used to resolve relative paths. Null = home. */
  getCwd: () => string | null;
  /** Workspace root (explorer root). Used by tools that operate over the project. */
  getWorkspaceRoot: () => string | null;
  /** Last N lines of the active terminal buffer (or null if not a terminal tab). */
  getTerminalContext: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  /**
   * Type a string into the active terminal at the prompt — without executing.
   * Returns false if there is no active terminal tab to inject into.
   */
  injectIntoActivePty: (text: string) => boolean;
  /** Open a new preview tab (in-app iframe) at the given URL. */
  openPreview: (url: string) => boolean;
  /** Spawn a Claude Code agent in a new terminal tab, bound to this session. */
  spawnAgent: (prompt: string) => { tabId: number; leafId: number } | null;
  /** Read the terminal scrollback tail of a managed agent's leaf. */
  readAgentOutput: (leafId: number) => string | null;
  readCache: Map<string, { size: number; hash: number }>;
  /** Active chat session id — used by tools that persist per-session state (todos). */
  getSessionId: () => string | null;
};

/**
 * Resolves a tool's `needsApproval` for the current invocation. Pass the
 * tool's intended gate as `needsApproval` and wrap it in a thunk
 * (`needsApproval: () => gateApproval(true)`) so the pref is read live on each
 * call, not captured once at tool-definition time.
 *
 * Bypass on -> false (the approval prompt is skipped). Bypass off -> the
 * tool's own `needsApproval`. Only the prompt is skipped: the fs/shell
 * deny-lists in each tool's execute (checkWritableCanonical /
 * checkShellCommand) still run. Agent spawn/steer are hard-pinned to
 * `needsApproval: true` and never pass through this helper.
 */
export function gateApproval(needsApproval: boolean): boolean {
  if (usePreferencesStore.getState().aiBypassPermissions) return false;
  return needsApproval;
}

export function resolvePath(rawPath: string, cwd: string | null): string {
  if (rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath))
    return rawPath;
  if (!cwd)
    throw new Error(
      `cannot resolve relative path "${rawPath}": no active terminal cwd. Pass an absolute path.`,
    );
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return cwd.endsWith(sep) ? `${cwd}${rawPath}` : `${cwd}${sep}${rawPath}`;
}
