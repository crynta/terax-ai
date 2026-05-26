/**
 * Match file-path candidates in a single terminal line. The output is
 * deliberately permissive — false positives are filtered later by an
 * existence check against the filesystem. We only do *cheap* rejection
 * here for tokens that obviously cannot be files (URLs, semver, hashes,
 * timestamps), to avoid wasting fs probes.
 *
 * Each result includes the byte range *in the input line* so xterm can
 * convert it to a buffer-cell range for underline + click hit-testing.
 */
export interface PathCandidate {
  /** The exact substring as it appears in the line. */
  text: string;
  /** Inclusive start index into the line. */
  start: number;
  /** Exclusive end index into the line. */
  end: number;
  /** The file-path part (without trailing `:line[:col]`). */
  path: string;
  line?: number;
  col?: number;
}

const MAX_LINE_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 512;
const MAX_CANDIDATES_PER_LINE = 32;

// Matches path-like tokens with optional :LINE[:COL] suffix.
// Groups:
//   (1) LINE number if present
//   (2) COL number if present
//
// Path forms handled:
//   C:\Win\path or C:/Win/path  (Windows drive)
//   /abs/path                   (POSIX absolute)
//   ./rel or ../rel             (relative with explicit prefix)
//   bare.ext                    (single token with dot)
//   multi/segment               (contains slash)
//
// We allow leading `/` explicitly in the alternation so POSIX absolute paths
// are captured with their leading slash.
const PATH_REGEX =
  /(?:[A-Za-z]:[\\/][A-Za-z0-9_./\\-]*|\/[A-Za-z0-9_~][A-Za-z0-9_./\\-]*|\.{1,2}[\\/][A-Za-z0-9_~][A-Za-z0-9_./\\-]*|[A-Za-z0-9_~][A-Za-z0-9_./\\-]+)(?::(\d+)(?::(\d+))?)?/g;

// Pure number (123 or 12.345) — no slash, no letter.
const PURE_NUMBER_REGEX = /^\d+(?:\.\d+)*$/;
// Semver-ish: 1.2.3, 1.2.3-rc.1 — three or more dot-separated digit groups.
const SEMVER_REGEX = /^\d+\.\d+(?:\.\d+)+(?:[.\-][A-Za-z0-9]+)*$/;
// Hex hash: 7+ hex chars, no dot, no slash.
const HEX_HASH_REGEX = /^[0-9a-f]{7,}$/i;

function looksLikeNonPath(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return true;
  if (PURE_NUMBER_REGEX.test(token)) return true;
  if (SEMVER_REGEX.test(token)) return true;
  if (HEX_HASH_REGEX.test(token)) return true;
  // Pure single-word tokens with no slash, no dot — not a path.
  if (!token.includes("/") && !token.includes("\\") && !token.includes(".")) {
    return true;
  }
  // A bare-filename candidate must have a real extension (1-6 letter/digit chars
  // after the final dot). "foo." or "foo.123" are not files; "foo.ts" / "foo.md" are.
  if (!token.includes("/") && !token.includes("\\")) {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return true;
    const ext = token.slice(dot + 1);
    if (!/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(ext)) return true;
  }
  return false;
}

export function extractPathCandidates(line: string): PathCandidate[] {
  if (line.length > MAX_LINE_LENGTH) return [];

  const out: PathCandidate[] = [];
  // Reset the regex's lastIndex — the `g` flag preserves state across calls.
  PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_REGEX.exec(line)) !== null) {
    if (out.length >= MAX_CANDIDATES_PER_LINE) break;
    const text = match[0];
    const start = match.index;
    const end = start + text.length;
    const lineNum = match[1] !== undefined ? Number(match[1]) : undefined;
    const colNum = match[2] !== undefined ? Number(match[2]) : undefined;

    // Reject tokens that are part of a URL. In `https://example.com/foo.ts`,
    // the regex matches `/example.com/foo.ts` (POSIX-absolute form) starting
    // at the second `/` of `://`. Check for `://` in the two characters before
    // the token's start (which would be `:/` sitting before our leading `/`).
    if (start >= 2 && line.slice(start - 2, start) === ":/") continue;
    // Also catch if the matched token itself starts with `://` (edge case).
    if (text.startsWith("://")) continue;

    // Strip the :LINE[:COL] suffix to get the bare path.
    let path = text;
    if (lineNum !== undefined) {
      // For Windows paths starting with "C:", skip the drive colon.
      const searchFrom = /^[A-Za-z]:/.test(text) ? 2 : 0;
      const colonIdx = text.indexOf(":", searchFrom);
      if (colonIdx !== -1) path = text.slice(0, colonIdx);
    }
    if (looksLikeNonPath(path)) continue;
    out.push({ text, start, end, path, line: lineNum, col: colNum });
  }
  return out;
}
