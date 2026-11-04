export type TerminalLinkKind = "osc8" | "url" | "path";

export type TerminalTextLink = {
  /** UTF-16 offsets into the scanned text, end exclusive. */
  start: number;
  end: number;
  /** The destination for URLs, the matched text for paths. */
  uri: string;
  kind: "url" | "path";
  path?: string;
  line?: number;
  column?: number;
};

/** A run of cells on one viewport row, end exclusive. */
export type TerminalLinkSegment = {
  readonly row: number;
  readonly start: number;
  readonly end: number;
};

export type TerminalLinkHit = {
  readonly kind: TerminalLinkKind;
  readonly uri: string;
  /** Text shown in the cells, bounded; empty when it could not be read. */
  readonly text: string;
  readonly segments: readonly TerminalLinkSegment[];
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
};

/** Pure text scanner; reference patterns can plug in as further matchers. */
export type LinkMatcher = (text: string) => TerminalTextLink[];

const MAX_LINKS = 256;
const MAX_PATH_LENGTH = 1024;
const MAX_LINE_NUMBER = 9_999_999;

export function urlLinkMatcher(text: string): TerminalTextLink[] {
  const links: TerminalTextLink[] = [];
  const pattern =
    /(?:https?:\/\/|mailto:|file:\/\/)[^\s<>"'`\u0000-\u001f\u007f]+/giu;
  for (
    let match = pattern.exec(text);
    match && links.length < MAX_LINKS;
    match = pattern.exec(text)
  ) {
    let uri = match[0].replace(/[.,;:!?]+$/, "");
    const balance = [0, 0, 0];
    const opens = "([{",
      closes = ")]}";
    for (let index = 0; index < uri.length; index++) {
      const open = opens.indexOf(uri[index]);
      const close = closes.indexOf(uri[index]);
      if (open >= 0) balance[open]++;
      if (close >= 0) balance[close]--;
    }
    let end = uri.length;
    while (end > 0) {
      const close = closes.indexOf(uri[end - 1]);
      if (close < 0 || balance[close] >= 0) break;
      balance[close]++;
      end--;
    }
    uri = uri.slice(0, end);
    try {
      const parsed = new URL(uri);
      const hostless =
        parsed.protocol === "mailto:" || parsed.protocol === "file:";
      if (!hostless && !parsed.hostname) continue;
      if (parsed.protocol === "file:" && parsed.pathname.length <= 1) continue;
      links.push({
        start: match.index,
        end: match.index + uri.length,
        uri,
        kind: "url",
      });
    } catch {
      /* Incomplete URLs stay ordinary terminal text. */
    }
  }
  return links;
}

const TLD_LIKE_EXTENSIONS = new Set([
  "ai",
  "app",
  "co",
  "com",
  "dev",
  "edu",
  "gov",
  "internal",
  "io",
  "lan",
  "local",
  "me",
  "net",
  "org",
  "test",
  "uk",
  "us",
]);

export function pathLinkMatcher(text: string): TerminalTextLink[] {
  const links: TerminalTextLink[] = [];
  const length = text.length;
  let index = 0;
  while (index < length && links.length < MAX_LINKS) {
    while (index < length && isPathDelimiter(text.charCodeAt(index))) index++;
    const tokenStart = index;
    while (index < length && !isPathDelimiter(text.charCodeAt(index))) index++;
    if (index === tokenStart) continue;
    if (index - tokenStart > MAX_PATH_LENGTH) continue;
    const link = pathLinkFromToken(text, tokenStart, index);
    if (link) {
      links.push(link);
      if (link.end > index) index = link.end;
    }
  }
  return links;
}

function pathLinkFromToken(
  text: string,
  start: number,
  tokenEnd: number,
): TerminalTextLink | null {
  let end = tokenEnd;
  while (end > start && /[.,;:!?]/.test(text[end - 1])) end--;
  if (end <= start) return null;
  const token = text.slice(start, end);
  if (token.includes("://")) return null;

  let path = token;
  let line: number | undefined;
  let column: number | undefined;
  const colon = /:(\d{1,7})(?::(\d{1,7}))?(?:-\d{1,7})?$/.exec(token);
  if (colon && colon.index > 0) {
    path = token.slice(0, colon.index);
    line = Number(colon[1]);
    column = colon[2] === undefined ? undefined : Number(colon[2]);
  }

  let linkEnd = end;
  if (line === undefined && end === tokenEnd) {
    const suffix = locationSuffix(text, end);
    if (suffix) {
      line = suffix.line;
      column = suffix.column;
      linkEnd = end + suffix.length;
    }
  }
  if (line !== undefined && (line > MAX_LINE_NUMBER || line < 0)) return null;
  if (!isPathShape(path, line !== undefined)) return null;
  return {
    start,
    end: linkEnd,
    uri: text.slice(start, linkEnd),
    kind: "path",
    path,
    line,
    column,
  };
}

/** `(10,5)` after a path, or Python's `", line 10`. */
function locationSuffix(
  text: string,
  from: number,
): { line: number; column?: number; length: number } | null {
  const rest = text.slice(from, from + 40);
  const paren = /^\((\d{1,7})(?:,\s?(\d{1,7}))?\)/.exec(rest);
  if (paren) {
    return {
      line: Number(paren[1]),
      column: paren[2] === undefined ? undefined : Number(paren[2]),
      length: paren[0].length,
    };
  }
  const python = /^["']?, line (\d{1,7})/.exec(rest);
  if (python) return { line: Number(python[1]), length: python[0].length };
  return null;
}

function isPathShape(path: string, hasLocation: boolean): boolean {
  if (path.length < 2 || path.length > MAX_PATH_LENGTH) return false;
  if (/^[A-Za-z]:[\\/]./.test(path)) return true;
  if (/^~[\\/]./.test(path)) return true;
  if (/^\.{1,2}[\\/]./.test(path)) return true;
  if (path.startsWith("/")) {
    if (path.startsWith("//")) return false;
    const segments = path.split("/").filter(Boolean);
    return segments.length >= 2 || hasLocation || hasExtension(path);
  }
  if (/^[-+]/.test(path)) return false;
  const separated = /[\\/]/.test(path);
  if (separated) {
    if (/^[\d./\\-]+$/.test(path)) return false;
    return hasExtension(path);
  }
  if (!hasLocation) return false;
  const extension = /\.([A-Za-z][A-Za-z0-9]{0,11})$/.exec(path);
  if (!extension || !/^[\w@+-][\w@.+-]*$/.test(path)) return false;
  return !TLD_LIKE_EXTENSIONS.has(extension[1].toLowerCase());
}

function hasExtension(path: string): boolean {
  return /\.[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(path);
}

function isPathDelimiter(code: number): boolean {
  if (code <= 0x20 || code === 0x7f) return true;
  switch (code) {
    case 0x22: // "
    case 0x27: // '
    case 0x60: // `
    case 0x28: // (
    case 0x29: // )
    case 0x5b: // [
    case 0x5d: // ]
    case 0x7b: // {
    case 0x7d: // }
    case 0x3c: // <
    case 0x3e: // >
    case 0x7c: // |
    case 0x3b: // ;
    case 0x2c: // ,
    case 0x2a: // *
    case 0x3f: // ?
    case 0x3d: // =
      return true;
    default:
      return false;
  }
}

export const DEFAULT_LINK_MATCHERS: readonly LinkMatcher[] = [
  urlLinkMatcher,
  pathLinkMatcher,
];

/** Earlier matchers win an overlap, then the longer span. */
export function detectTerminalLinks(
  text: string,
  matchers: readonly LinkMatcher[] = DEFAULT_LINK_MATCHERS,
): TerminalTextLink[] {
  const candidates: { link: TerminalTextLink; rank: number }[] = [];
  matchers.forEach((matcher, rank) => {
    for (const link of matcher(text)) candidates.push({ link, rank });
  });
  if (candidates.length === 0) return [];
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.link.start - b.link.start ||
      b.link.end - a.link.end,
  );
  const accepted: TerminalTextLink[] = [];
  for (const { link } of candidates) {
    if (accepted.length >= MAX_LINKS) break;
    if (accepted.some((a) => link.start < a.end && a.start < link.end)) {
      continue;
    }
    accepted.push(link);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/** Row segments for the inclusive cell indices `first..last` of a cols-wide grid. */
export function cellSpanSegments(
  first: number,
  last: number,
  cols: number,
  rowBase: number,
): TerminalLinkSegment[] {
  const segments: TerminalLinkSegment[] = [];
  if (cols <= 0 || last < first) return segments;
  for (
    let row = Math.floor(first / cols);
    row <= Math.floor(last / cols);
    row++
  ) {
    const start = Math.max(first, row * cols) - row * cols;
    const end = Math.min(last, row * cols + cols - 1) - row * cols + 1;
    segments.push({ row: rowBase + row, start, end });
  }
  return segments;
}

/** First index whose value is >= target in a non-decreasing array. */
export function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** First index whose value is > target in a non-decreasing array. */
export function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The grid cell for fractional cell coordinates, or null outside the grid. */
export function cellAtPoint(
  column: number,
  row: number,
  cols: number,
  rows: number,
): { readonly row: number; readonly column: number } | null {
  const c = Math.floor(column);
  const r = Math.floor(row);
  if (!(c >= 0 && c < cols && r >= 0 && r < rows)) return null;
  return { row: r, column: c };
}
