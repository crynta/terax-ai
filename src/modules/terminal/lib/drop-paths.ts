export type TerminalDropPlatform = "unix" | "windows";

export function buildDroppedPathInput(
  paths: readonly string[],
  platform: TerminalDropPlatform,
): string | null {
  const quoted = paths
    .filter((path) => path.length > 0)
    .map((path) =>
      platform === "windows" ? quoteWindowsPath(path) : quoteUnixPath(path),
    );
  if (quoted.length === 0) return null;
  return `${quoted.join(" ")} `;
}

function quoteUnixPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function quoteWindowsPath(path: string): string {
  return `"${path.replace(/"/g, '`"')}"`;
}
