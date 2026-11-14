const DRIVE_ROOT = /^(?:[/\\]{2}\?[/\\])?[a-z]:[/\\]/i;

function lastSeparator(path: string, hasDriveRoot: boolean): number {
  const windows =
    hasDriveRoot || path.startsWith("\\\\") || path.startsWith("//");
  return Math.max(path.lastIndexOf("/"), windows ? path.lastIndexOf("\\") : -1);
}

export function pathBasename(path: string): string {
  return path.slice(lastSeparator(path, DRIVE_ROOT.test(path)) + 1);
}

export function parentDir(path: string, fallback = path): string {
  const driveRoot = DRIVE_ROOT.exec(path)?.[0];
  const i = lastSeparator(path, driveRoot !== undefined);
  if (i < 0) return fallback;
  // A drive letter without its separator is relative to that drive's cwd.
  if (i === 0 || i + 1 === driveRoot?.length) return path.slice(0, i + 1);
  return path.slice(0, i);
}
