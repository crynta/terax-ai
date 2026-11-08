export function parentDir(path: string, fallback = path): string {
  const driveRoot = /^(?:[/\\]{2}\?[/\\])?[a-z]:[/\\]/i.exec(path)?.[0];
  const windows =
    driveRoot !== undefined || path.startsWith("\\\\") || path.startsWith("//");
  const i = Math.max(
    path.lastIndexOf("/"),
    windows ? path.lastIndexOf("\\") : -1,
  );
  if (i < 0) return fallback;
  // A drive letter without its separator is relative to that drive's cwd.
  if (i === 0 || i + 1 === driveRoot?.length) return path.slice(0, i + 1);
  return path.slice(0, i);
}
