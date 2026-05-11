export function isSshPath(path: string): boolean {
  return path.startsWith("ssh://");
}

export function parseSshPath(path: string): { name: string; remotePath: string } {
  const withoutScheme = path.slice("ssh://".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    return { name: withoutScheme, remotePath: "/" };
  }
  return {
    name: withoutScheme.slice(0, slashIdx),
    remotePath: withoutScheme.slice(slashIdx),
  };
}
