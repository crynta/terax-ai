export function isRemotePath(path: string): boolean {
  return path.startsWith("ssh://");
}

export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function dirname(path: string): string {
  if (!isRemotePath(path)) {
    const i = path.lastIndexOf("/");
    if (i <= 0) return "/";
    return path.slice(0, i);
  }

  const pathStart = path.indexOf("/", "ssh://".length);
  if (pathStart < 0) return `${path}/`;
  if (pathStart === path.length - 1) return path;

  const i = path.lastIndexOf("/");
  if (i <= pathStart) return path.slice(0, pathStart + 1);
  return path.slice(0, i);
}

export function basename(path: string): string {
  const trimmed = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

export function remoteUriPath(uri: string): string | null {
  if (!isRemotePath(uri)) return null;
  const pathStart = uri.indexOf("/", "ssh://".length);
  if (pathStart < 0) return "/";
  return uri.slice(pathStart) || "/";
}
