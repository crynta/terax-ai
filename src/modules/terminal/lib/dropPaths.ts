const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export function quotePathForShell(path: string): string {
  const clean = path.replace(CONTROL_CHARS, "");
  if (isWindowsLikePath(clean)) return quotePathForWindowsShell(clean);
  return `'${clean.replace(/'/g, `'\\''`)}'`;
}

export function pathsToTerminalPaste(paths: readonly string[]): string {
  const quoted = paths
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map(quotePathForShell);
  return quoted.length > 0 ? `${quoted.join(" ")} ` : "";
}

function isWindowsLikePath(path: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("\\\\") ||
    path.includes("\\")
  );
}

// PowerShell-style double-quote with backtick escapes (`"`, backtick, `$`).
// Modern Windows shells (pwsh / Windows PowerShell) interpolate `$var` inside
// double quotes; cmd.exe ignores the backtick and treats it as a literal,
// which is acceptable because filenames cannot contain `"` on Windows.
function quotePathForWindowsShell(path: string): string {
  return `"${path.replace(/(["`$])/g, "`$1")}"`;
}
