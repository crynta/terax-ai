import type { TerminalLinkHit } from "./terminalLinks";

export const MAX_LINK_URI_LENGTH = 8192;

export type LinkConfirmReason = "userinfo" | "punycode" | "mismatch" | "scheme";

export type LinkPlan =
  | { type: "open-url"; url: string }
  | {
      type: "confirm-url";
      url: string;
      reason: LinkConfirmReason;
      destination: string;
    }
  | { type: "path"; path: string; line?: number; column?: number }
  | { type: "file-uri"; host: string; path: string }
  | { type: "block"; reason: "scheme" | "invalid" | "length"; scheme: string };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Decides what activating a link may do. Only http and https open directly,
 * and an OSC 8 link only when its visible text is its address; mailto and tel
 * ask first. File URLs and paths are resolved against the file system by the
 * caller; everything else is blocked.
 */
export function planLinkActivation(hit: TerminalLinkHit): LinkPlan {
  if (hit.kind === "path") {
    if (!hit.path) return { type: "block", reason: "invalid", scheme: "" };
    return {
      type: "path",
      path: hit.path,
      line: hit.line,
      column: hit.column,
    };
  }

  const uri = hit.uri;
  if (uri.length > MAX_LINK_URI_LENGTH) {
    return { type: "block", reason: "length", scheme: "" };
  }
  if (CONTROL_CHARACTERS.test(uri)) {
    return { type: "block", reason: "invalid", scheme: "" };
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { type: "block", reason: "invalid", scheme: "" };
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();

  if (scheme === "http" || scheme === "https") {
    if (!parsed.hostname) {
      return { type: "block", reason: "invalid", scheme };
    }
    const url = parsed.href;
    const destination = parsed.host;
    if (parsed.username || parsed.password) {
      return { type: "confirm-url", url, reason: "userinfo", destination };
    }
    if (parsed.hostname.split(".").some((label) => label.startsWith("xn--"))) {
      return { type: "confirm-url", url, reason: "punycode", destination };
    }
    if (hit.kind === "osc8" && !linkTextIsDestination(hit.text, uri, url)) {
      return { type: "confirm-url", url, reason: "mismatch", destination };
    }
    return { type: "open-url", url };
  }
  if (scheme === "mailto" || scheme === "tel") {
    return {
      type: "confirm-url",
      url: parsed.href,
      reason: "scheme",
      destination: parsed.pathname,
    };
  }
  if (scheme === "file") {
    const local = fileUrlToLocal(parsed);
    if (!local) return { type: "block", reason: "invalid", scheme };
    return { type: "file-uri", host: local.host, path: local.path };
  }
  return { type: "block", reason: "scheme", scheme };
}

function fileUrlToLocal(parsed: URL): { host: string; path: string } | null {
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.length <= 1 || CONTROL_CHARACTERS.test(path)) return null;
  // An escaped slash can turn an empty-host URL into a network path
  // (file:///%2Fserver/share is //server/share), and on Windows opening it
  // would reach out to that server. UNC and device prefixes, in any mix of
  // slashes and backslashes, are never local.
  if (isNetworkOrDevicePath(path)) return null;
  if (/^\/[A-Za-z]:(?:\/|$)/.test(path)) path = path.slice(1);
  return { host: parsed.hostname, path };
}

export function isNetworkOrDevicePath(path: string): boolean {
  return /^[\\/]{2}/.test(path);
}

/** An empty or loopback host, or the machine's own name (short or full). */
export function isLocalFileHost(
  host: string,
  localHostname: string | null,
): boolean {
  const name = host.toLowerCase();
  if (name === "" || name === "localhost") return true;
  if (!localHostname) return false;
  const local = localHostname.toLowerCase();
  return name === local || name.split(".")[0] === local.split(".")[0];
}

const SCHEMED = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Whether the text drawn for an OSC 8 link is its address. Anything else, from
 * "click here" to another site's name, is the classic bait-and-switch and gets
 * a confirmation that shows the real destination. Text without a scheme may
 * leave it out ("example.com/a" for https://example.com/a).
 */
export function linkTextIsDestination(
  text: string,
  uri: string,
  href: string = uri,
): boolean {
  const shown = text.trim();
  if (!shown) return false;
  try {
    const destination = new URL(href);
    const address = new URL(
      SCHEMED.test(shown) ? shown : `${destination.protocol}//${shown}`,
    );
    return address.href === destination.href;
  } catch {
    return false;
  }
}

const MAX_DESTINATION_LABEL = 300;

/** What a hovered link points at, for the preview chip and tooltip. */
export function linkDestinationLabel(hit: TerminalLinkHit): string {
  const base =
    hit.kind === "path" && hit.path
      ? `${hit.path}${hit.line === undefined ? "" : `:${hit.line}${hit.column === undefined ? "" : `:${hit.column}`}`}`
      : hit.uri;
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "");
  return clean.length > MAX_DESTINATION_LABEL
    ? `${clean.slice(0, MAX_DESTINATION_LABEL)}...`
    : clean;
}

export type PathContext = {
  readonly cwd: string | null;
  readonly home: string | null;
};

/**
 * Canonical (forward-slash) absolute path for text found in terminal output,
 * or null when it is relative and no base is known.
 */
export function resolveLinkPath(
  raw: string,
  context: PathContext,
): string | null {
  let path = raw;
  const windowsCwd =
    context.cwd !== null && /^(?:[A-Za-z]:|[\\/]{2})/.test(context.cwd);
  if (windowsCwd || /^(?:[A-Za-z]:[\\/]|[\\/]{2}|~\\)/.test(path)) {
    path = path.replace(/\\/g, "/");
  }
  if (path.startsWith("~/")) {
    if (!context.home) return null;
    path = `${context.home.replace(/\\/g, "/").replace(/\/+$/, "")}/${path.slice(2)}`;
  } else if (!isAbsolutePath(path)) {
    if (!context.cwd) return null;
    path = `${context.cwd.replace(/\\/g, "/").replace(/\/+$/, "")}/${path}`;
  }
  // The filesystem must resolve .. after following any preceding symlink.
  return path;
}

/** Candidates to try in order: git diff headers prefix paths with a/ and b/. */
export function pathCandidates(raw: string): string[] {
  if (/^[ab]\/[^/]/.test(raw)) return [raw, raw.slice(2)];
  return [raw];
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
