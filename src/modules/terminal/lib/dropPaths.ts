export function quotePathForShell(path: string): string {
  if (isWindowsLikePath(path)) return quotePathForWindowsShell(path);
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function pathsToTerminalPaste(paths: string[]): string {
  const quoted = paths.filter(Boolean).map(quotePathForShell);
  return quoted.length > 0 ? `${quoted.join(" ")} ` : "";
}

function isWindowsLikePath(path: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("\\\\") ||
    path.includes("\\")
  );
}

function quotePathForWindowsShell(path: string): string {
  return `"${path.replace(/(["`$])/g, "`$1")}"`;
}
