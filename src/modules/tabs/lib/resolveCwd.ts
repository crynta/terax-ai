import type { Tab } from "./useTabs";

/**
 * Resolve the cwd a new terminal tab should inherit.
 *
 * Priority (highest → lowest):
 *   1. Active terminal tab's live cwd
 *   2. Last cwd seen from any terminal (tracked by the caller)
 *   3. User-configured default directory (Settings → General → Default directory)
 *   4. Workspace home directory
 *   5. undefined (caller decides)
 */
export function resolveInheritedCwd(
  activeTab: Tab | undefined,
  lastTerminalCwd: string | null,
  defaultCwd: string | null | undefined,
  home: string | null,
): string | undefined {
  if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
  // Use || not ?? so that empty strings (the store default for an unconfigured
  // defaultCwd) are treated the same as null/undefined and fall through.
  return lastTerminalCwd || defaultCwd || home || undefined;
}
