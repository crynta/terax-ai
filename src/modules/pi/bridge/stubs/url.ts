// Browser shim for node:url.
// Pi SDK uses pathToFileURL and fileURLToPath.

export function pathToFileURL(path: string): URL {
  return new URL(`file://${path}`);
}

export function fileURLToPath(url: string | URL): string {
  const u = typeof url === "string" ? new URL(url) : url;
  return decodeURIComponent(u.pathname);
}
