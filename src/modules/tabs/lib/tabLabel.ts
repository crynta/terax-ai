import type { Tab } from "./useTabs";

/** Map a configured shell path to a compact display name. Returns "" when the
 *  setting is empty (auto-detected) or the shell is unknown, so callers fall
 *  back to the cwd-derived name. */
export function shellDisplayName(shell: string | undefined): string {
  if (!shell) return "";
  const base = shell.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const stem = base.replace(/\.exe$/i, "");
  switch (stem.toLowerCase()) {
    case "pwsh":
    case "powershell":
      return "PowerShell";
    case "bash":
      return "Git Bash";
    case "zsh":
      return "Zsh";
    case "fish":
      return "Fish";
    case "cmd":
      return "Cmd";
    default:
      return stem || "";
  }
}

// A shell like Git Bash writes an OSC title of the form "zhaid@HOSTNAME ~" and
// tracks the cwd separately. The user portion is the signal that the natural
// label (the home folder's basename) would be a bare, useless username.
const USERNAME_TITLE = /^([\w.-]+)@[\w.-]+/;

/** True when the OSC title's user is the label we would otherwise show. */
function showsUsername(label: string, osTitle: string | undefined): boolean {
  const user = USERNAME_TITLE.exec((osTitle ?? "").trim())?.[1];
  if (user !== undefined && label.toLowerCase() === user.toLowerCase()) {
    return true;
  }
  // No cwd available: the raw OSC title ("zhaid@HOSTNAME ~") is all we have.
  return USERNAME_TITLE.test(label.trim());
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then fall back to the last segment of the
 * cwd. When that would render as the bare username from the shell's OSC title
 * (Git Bash writes "zhaid@HOSTNAME ~"), show the shell's display name instead.
 * Keeping this pure makes the "custom name survives a cd" invariant testable
 * without rendering the bar.
 */
export function labelFor(t: Tab, terminalShell?: string): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.customTitle) return t.customTitle;

  const natural = !t.cwd
    ? t.title
    : (t.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "/");

  // "zhaid" (or an empty label) is a useless tab label — swap it for the
  // shell's display name when one is configured.
  if (natural === "" || showsUsername(natural, t.title)) {
    const shell = shellDisplayName(terminalShell);
    if (shell) return shell;
  }
  return natural;
}
