const RESERVED_HOSTS = new Set([
  "asset.localhost",
  "tauri.localhost",
  "ipc.localhost",
  "terax-pty.localhost",
]);

export function isAllowedPreviewUrl(
  rawUrl: string,
  appOrigin = typeof location === "undefined" ? "" : location.origin,
): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !RESERVED_HOSTS.has(url.hostname.toLowerCase().replace(/\.$/, "")) &&
      url.origin !== appOrigin
    );
  } catch {
    return false;
  }
}

const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

export function loopbackPreviewOrigin(rawUrl: string): string | null {
  try {
    if (!isAllowedPreviewUrl(rawUrl)) return null;
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      hostname !== "0.0.0.0" &&
      hostname !== "[::1]" &&
      !IPV4_LOOPBACK.test(hostname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
