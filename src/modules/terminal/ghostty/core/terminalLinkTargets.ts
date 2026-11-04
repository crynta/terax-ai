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
 * Decides what activating a link may do. Only http, https and mailto open
 * directly; file URLs and paths are resolved against the file system by the
 * caller; everything else is blocked or needs an explicit confirmation.
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
    if (hit.kind === "osc8" && linkTextMismatch(hit.text, parsed.hostname)) {
      return { type: "confirm-url", url, reason: "mismatch", destination };
    }
    return { type: "open-url", url };
  }
  if (scheme === "mailto") return { type: "open-url", url: parsed.href };
  if (scheme === "tel") {
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

export function fileUrlToLocal(
  parsed: URL,
): { host: string; path: string } | null {
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.length <= 1) return null;
  if (/^\/[A-Za-z]:(?:\/|$)/.test(path)) path = path.slice(1);
  return { host: parsed.hostname, path };
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

const COMMON_TLDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "edu",
  "gov",
  "me",
  "us",
  "uk",
  "de",
  "fr",
  "jp",
  "cn",
  "ru",
  "in",
  "br",
  "ca",
  "au",
  "info",
  "biz",
  "xyz",
  "cloud",
  "tech",
  "online",
  "site",
]);

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** The host a piece of link text claims to point at, when it looks like one. */
export function hostShownByText(text: string): string | null {
  const match =
    /^\s*(?:([a-z][a-z0-9+.-]*):\/\/)?(?:[^\s/@?#]*@)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::\d+)?(?:[/?#\s]|$)/i.exec(
      text,
    );
  if (!match) return null;
  const host = match[2];
  const tld = host.slice(host.lastIndexOf(".") + 1).toLowerCase();
  if (match[1] || host.toLowerCase().startsWith("www.")) return host;
  return COMMON_TLDS.has(tld) ? host : null;
}

export function linkTextMismatch(text: string, hostname: string): boolean {
  const shown = hostShownByText(text);
  if (!shown) return false;
  const a = normalizeHost(shown);
  const b = normalizeHost(hostname);
  return a !== b && !a.endsWith(`.${b}`) && !b.endsWith(`.${a}`);
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
  const windowsCwd = context.cwd !== null && /^[A-Za-z]:/.test(context.cwd);
  if (windowsCwd || /^[A-Za-z]:[\\/]/.test(path) || /^~\\/.test(path)) {
    path = path.replace(/\\/g, "/");
  }
  if (path.startsWith("~/")) {
    if (!context.home) return null;
    path = `${context.home.replace(/\\/g, "/").replace(/\/+$/, "")}/${path.slice(2)}`;
  } else if (!isAbsolutePath(path)) {
    if (!context.cwd) return null;
    path = `${context.cwd.replace(/\\/g, "/").replace(/\/+$/, "")}/${path}`;
  }
  return normalizePath(path);
}

/** Candidates to try in order: git diff headers prefix paths with a/ and b/. */
export function pathCandidates(raw: string): string[] {
  if (/^[ab]\/[^/]/.test(raw)) return [raw, raw.slice(2)];
  return [raw];
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function normalizePath(path: string): string {
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? "";
  const rest = path.slice(drive.length);
  const out: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `${drive}/${out.join("/")}`;
}
