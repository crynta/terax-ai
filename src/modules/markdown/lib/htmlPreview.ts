const normalize = (path: string) => path.replace(/\\/g, "/");

export function pathsInclude(paths: readonly string[], path: string): boolean {
  const target = normalize(path);
  return paths.some((p) => normalize(p) === target);
}

/**
 * `convertFileSrc` encodes the whole path as one segment, so a page's relative
 * URLs (`css/site.css`) would resolve against the asset root. Encoding each
 * segment keeps real slashes for the browser while the asset protocol, which
 * percent-decodes everything after the first `/`, still gets the same file.
 * `base` is `convertFileSrc("")`, the platform's asset origin plus `/`.
 */
export function htmlPreviewAssetUrl(base: string, path: string): string {
  const normalized = normalize(path);
  const absolute = normalized.startsWith("/");
  const segments = (absolute ? normalized.slice(1) : normalized).split("/");
  return `${base}${absolute ? "%2F" : ""}${segments.map(encodeURIComponent).join("/")}`;
}

// The asset protocol ignores the query string, so a revision suffix only
// defeats WebKit's cache for the document without changing what is served.
export function htmlPreviewSrc(assetUrl: string, revision: number): string {
  if (revision === 0) return assetUrl;
  const sep = assetUrl.includes("?") ? "&" : "?";
  return `${assetUrl}${sep}v=${revision}`;
}
