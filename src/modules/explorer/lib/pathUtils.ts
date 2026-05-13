export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

export function affectedDirsForPath(
  path: string,
  rootPath: string,
  isLoadedDir: (path: string) => boolean = () => true,
): string[] {
  if (rootPath !== "/" && path !== rootPath && !path.startsWith(joinPath(rootPath, ""))) {
    return [];
  }
  if (rootPath === "/" && !path.startsWith("/")) return [];

  const dirs = new Set<string>();
  let current = path;

  const parent = dirname(current);
  if (parent === rootPath || isLoadedDir(parent)) dirs.add(parent);

  while (current && current !== rootPath && current !== "/") {
    if (current === rootPath || isLoadedDir(current)) dirs.add(current);
    const next = dirname(current);
    if (next === current) break;
    current = next;
  }

  dirs.add(rootPath);
  return [...dirs];
}

export function togglePathExpansion(
  expanded: ReadonlySet<string>,
  path: string,
): { next: Set<string>; isCollapsing: boolean } {
  const next = new Set(expanded);
  const isCollapsing = next.has(path);

  if (isCollapsing) {
    next.delete(path);
  } else {
    next.add(path);
  }

  return { next, isCollapsing };
}
