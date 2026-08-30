const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

export function loopbackPreviewOrigin(rawUrl: string): string | null {
  try {
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
