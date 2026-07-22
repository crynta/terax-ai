/**
 * Maps a terminal shell executable path to a human-readable display name.
 * Used as the initial tab title so users can distinguish between different
 * shell types at a glance (PowerShell, Git Bash, WSL, etc.).
 */
export function shellLabel(shellPath: string | undefined | null): string {
  if (!shellPath) return "Terminal";

  const basename = shellPath.split(/[\\/]/).filter(Boolean).pop() ?? shellPath;
  const name = basename.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");

  const DISPLAY_NAMES: Record<string, string> = {
    pwsh: "PowerShell",
    powershell: "PowerShell",
    "powershell_ise": "PowerShell ISE",
    bash: "Bash",
    zsh: "Zsh",
    fish: "Fish",
    sh: "Shell",
    dash: "Dash",
    cmd: "Command Prompt",
    nu: "Nushell",
    elvish: "Elvish",
    "xonsh": "Xonsh",
    tcsh: "Tcsh",
    csh: "Csh",
    ksh: "Ksh",
    wsl: "WSL",
    "wsl.exe": "WSL",
  };

  return DISPLAY_NAMES[name] ?? basename.replace(/\.(exe|cmd|bat)$/i, "");
}
