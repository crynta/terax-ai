// Pure core of the "go to file" palette mode: query parsing, recency boost and
// match-highlight segmentation. No React, no IPC.

export type FileTarget = {
  /** What to fuzzy-match against file paths. */
  query: string;
  line?: number;
  column?: number;
};

const MAX_POSITION = 9_999_999;
const POSITION_SUFFIX = /^(.*?):(\d+)(?::(\d+))?$/;

function position(digits: string): number {
  return Math.min(Math.max(Number.parseInt(digits, 10), 1), MAX_POSITION);
}

/**
 * Splits `path:line` and `path:line:col` off a query. A dangling colon (still
 * typing the position) is dropped so results do not flicker to nothing.
 */
export function parseFileTarget(term: string): FileTarget {
  const trimmed = term.trim().replace(/:+$/, "").trim();
  const m = POSITION_SUFFIX.exec(trimmed);
  if (m) {
    const target: FileTarget = { query: m[1].trim(), line: position(m[2]) };
    if (m[3] !== undefined) target.column = position(m[3]);
    return target;
  }
  return { query: trimmed };
}

export type FileHit = {
  path: string;
  rel: string;
  name: string;
  /** Matcher score, comparable within one result set. */
  score: number;
  /** Matched character offsets in `rel` (Unicode scalars). */
  indices: readonly number[];
};

/** A recent file at the front of the list can outbid this share of the top score. */
export const RECENT_BOOST = 0.3;

/**
 * Re-ranks search hits so recently opened files float up. The boost is a share
 * of the best score, fading linearly with recency rank, so it nudges close
 * calls without letting an old, weak match outrank a clearly better one. Stable:
 * equal scores keep the search order.
 */
export function boostRecent<T extends { path: string; score: number }>(
  hits: readonly T[],
  recent: readonly string[],
): T[] {
  if (hits.length < 2 || recent.length === 0) return [...hits];
  const rank = new Map<string, number>();
  recent.forEach((p, i) => {
    if (!rank.has(p)) rank.set(p, i);
  });
  let top = 0;
  for (const h of hits) if (h.score > top) top = h.score;
  const span = Math.max(recent.length, 1);
  return hits
    .map((hit, order) => {
      const r = rank.get(hit.path);
      const bonus = r === undefined ? 0 : top * RECENT_BOOST * (1 - r / span);
      return { hit, order, total: hit.score + bonus };
    })
    .sort((a, b) => b.total - a.total || a.order - b.order)
    .map((x) => x.hit);
}

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** `path` relative to `root`, or `path` itself when it lies outside. */
export function relativeTo(root: string, path: string): string {
  const r = toPosix(root).replace(/\/+$/, "");
  const p = toPosix(path);
  return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

function basename(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? rel : rel.slice(i + 1);
}

/** Recent files as search hits, newest first, for an empty query. */
export function recentToHits(
  root: string,
  recent: readonly string[],
  limit: number,
): FileHit[] {
  return recent.slice(0, limit).map((path) => {
    const rel = relativeTo(root, path);
    return { path, rel, name: basename(rel), score: 0, indices: [] };
  });
}

export type Segment = { text: string; hit: boolean };

export type PathParts = {
  name: Segment[];
  /** Directory part without the trailing slash; empty for top-level files. */
  dir: Segment[];
};

function segments(chars: string[], marks: ReadonlySet<number>, from: number, to: number) {
  const out: Segment[] = [];
  for (let i = from; i < to; i++) {
    const hit = marks.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += chars[i];
    else out.push({ text: chars[i], hit });
  }
  return out;
}

/**
 * Splits a relative path into file name and directory, marking the characters
 * the matcher reported. Indices count Unicode scalars, so a path is walked by
 * code point, not UTF-16 unit.
 */
export function pathParts(rel: string, indices: readonly number[]): PathParts {
  const chars = Array.from(rel);
  const marks = new Set(indices);
  const slash = chars.lastIndexOf("/");
  return {
    dir: segments(chars, marks, 0, Math.max(slash, 0)),
    name: segments(chars, marks, slash + 1, chars.length),
  };
}
