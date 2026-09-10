/**
 * OpenCode Go / Zen (opencode.ai) is an OpenAI-compatible gateway that
 * rejects every chat request lacking an `x-opencode-session` header
 * ("Request is missing \"x-opencode-session\""). The value is an opaque
 * routing key that lets the gateway keep one conversation on the same
 * backend; any stable string works. Terax reaches these endpoints through
 * the generic OpenAI-compatible provider, so the header is attached by host.
 */

const OPENCODE_HOST = "opencode.ai";

/** One opaque key per app session: stable across requests, never user data. */
const processSessionKey: string =
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

export function isOpencodeBaseURL(baseURL: string): boolean {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return false;
  }
  // The session key is a routing credential for the gateway; it is only
  // attached over TLS, so a plain-http look-alike never receives it.
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host === OPENCODE_HOST || host.endsWith(`.${OPENCODE_HOST}`);
}

/**
 * Headers an OpenAI-compatible provider must send to `baseURL`, or undefined
 * when the endpoint needs none.
 */
export function opencodeSessionHeaders(
  baseURL: string,
  sessionKey: string = processSessionKey,
): Record<string, string> | undefined {
  if (!isOpencodeBaseURL(baseURL)) return undefined;
  return { "x-opencode-session": sessionKey };
}
