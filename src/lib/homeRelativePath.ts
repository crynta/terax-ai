export function homeRelativePath(path: string, home: string | null): string {
  const normalized = path.replace(/\\/g, "/");
  if (!home) return normalized;
  const root = home.replace(/\\/g, "/").replace(/\/+$/, "");
  const atBoundary =
    normalized.length === root.length || normalized[root.length] === "/";
  if (!atBoundary) return normalized;
  const prefix = normalized.slice(0, root.length);
  const windowsPath = /^[a-z]:(?:\/|$)/i.test(root) || root.startsWith("//");
  if (
    prefix === root ||
    (windowsPath && prefix.toLowerCase() === root.toLowerCase())
  ) {
    return `~${normalized.slice(root.length)}`;
  }
  return normalized;
}
