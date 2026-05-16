/**
 * Scans raw PTY output bytes for localhost URLs worth surfacing to the user —
 * primarily OAuth callback servers and local dev servers that CLIs spin up
 * during auth flows (e.g. `gh auth login`, `az login`, `gcloud auth login`).
 *
 * Mirrors the approach from wmux/src-tauri/src/url_detector.rs but runs in
 * the frontend alongside the existing xterm data pipeline so no Rust changes
 * are needed.
 */

export type DetectedUrl = {
  url: string;
  /** True when the URL looks like an OAuth callback / redirect endpoint. */
  isOauth: boolean;
};

// Matches ANSI/VT escape sequences so we can strip them before scanning.
// Covers: CSI (ESC [), OSC (ESC ]...BEL/ST), and simple 2-char escapes.
const ANSI_RE =
  /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\(B|[^[])|\r/g;

/**
 * Extract localhost URLs from a raw PTY byte chunk.
 * Only returns URLs that have an explicit port to avoid false-positives like
 * `http://localhost.attacker.com`.
 * Deduplication across chunks is the caller's responsibility.
 */
export function extractLocalhostUrls(bytes: Uint8Array): DetectedUrl[] {
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(ANSI_RE, "");

  const results: DetectedUrl[] = [];
  const seen = new Set<string>();

  // Match http(s)://localhost or 127.0.0.1 URLs, consuming path/query/fragment
  // but stopping at whitespace or common prose punctuation.
  const urlRe =
    /https?:\/\/(?:localhost|127\.0\.0\.1)(:\d+)(?:\/[^\s"'<>)\]]*)?/gi;

  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    // Strip trailing punctuation that's unlikely to be part of the URL.
    const raw = m[0].replace(/[.,;:!?)\]]+$/, "");
    if (seen.has(raw)) continue;
    seen.add(raw);
    results.push({ url: raw, isOauth: isOauthHint(raw) });
  }

  return results;
}

function isOauthHint(url: string): boolean {
  return (
    /\/(?:callback|oauth|auth|redirect|token|authorize)(?:[/?#]|$)/i.test(
      url,
    ) ||
    /[?&]code=/.test(url) ||
    /[?&]state=/.test(url)
  );
}
