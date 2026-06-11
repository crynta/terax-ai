// Subsequence scorer for the small in-memory sources only. File and content
// search are ranked server-side (ripgrep + nucleo), never here.

const BONUS_BOUNDARY = 10;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 8;
const BONUS_EXACT_CASE = 1;
const MAX_GAP_PENALTY = 3;

function isBoundary(ch: string): boolean {
  return ch === " " || ch === "-" || ch === "_" || ch === "/" || ch === ".";
}

function isCamelStart(target: string, i: number): boolean {
  const c = target.charCodeAt(i);
  const p = target.charCodeAt(i - 1);
  return c >= 65 && c <= 90 && !(p >= 65 && p <= 90);
}

export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;
  if (query.length > target.length) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let qi = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    let bonus = 1;
    if (ti === 0 || isBoundary(t[ti - 1])) bonus += BONUS_BOUNDARY;
    else if (isCamelStart(target, ti)) bonus += BONUS_CAMEL;
    if (lastMatch === ti - 1) bonus += BONUS_CONSECUTIVE;
    else if (lastMatch >= 0)
      bonus -= Math.min(ti - lastMatch - 1, MAX_GAP_PENALTY);
    if (target[ti] === query[qi]) bonus += BONUS_EXACT_CASE;

    score += bonus;
    lastMatch = ti;
    qi++;
  }

  return qi === q.length ? score : null;
}

export function fuzzyBest(query: string, candidates: string[]): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    const s = fuzzyScore(query, c);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}
