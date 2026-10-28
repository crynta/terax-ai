const MIB = 1024 * 1024;

/** Smallest scrollback byte limit a terminal is ever granted. */
export const MIN_SCROLLBACK_BYTES = MIB;
const MAX_SCROLLBACK_BYTES = 64 * MIB;
const DEFAULT_SCROLLBACK_LINES = 10_000;
const MAX_SCROLLBACK_LINES = 100_000;
const APPROXIMATE_BYTES_PER_SCROLLBACK_CELL = 8;

/**
 * Upper bound on scrollback bytes summed over every terminal. It is the
 * default limit of twenty 120-column terminals (10,000 lines, 8 bytes per
 * cell, about 9.6 MB each), so twenty ordinary tabs are never scaled; beyond
 * that the terminals share the budget fairly instead of growing without bound.
 */
export const DEFAULT_SCROLLBACK_BUDGET_BYTES = 192 * MIB;

/**
 * What every terminal keeps even when the budget is exhausted: about two
 * thousand lines at 120 columns. With more terminals than `budget / floor` the
 * total exceeds the budget by at most this much per additional terminal.
 */
export const SCROLLBACK_FLOOR_BYTES = 2 * MIB;

export type ScrollbackDemand = {
  /** The limit the configuration asks for. */
  readonly request: number;
  /** Page bytes the terminal holds now; a grant below this would prune history. */
  readonly held: number;
};

export function normalizeScrollbackLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_SCROLLBACK_LINES;
  }
  return clamp(Math.round(value), 1, MAX_SCROLLBACK_LINES);
}

/** The byte limit a terminal asks for, before the global budget is applied. */
export function requestedScrollbackBytes(lines: number, cols: number): number {
  return clamp(
    lines * cols * APPROXIMATE_BYTES_PER_SCROLLBACK_CELL,
    MIN_SCROLLBACK_BYTES,
    MAX_SCROLLBACK_BYTES,
  );
}

/**
 * Divides `budget` bytes of scrollback between terminals without ever taking
 * history away: WebAssembly memory cannot shrink, so pruning a live terminal
 * would lose its history and return nothing. Every terminal first keeps what
 * it holds (and at least `min(request, floor)`); the rest of the budget is
 * split max-min fairly over the remaining headroom, so a terminal asking for
 * less than the fair share keeps its request and the surplus goes to the
 * larger ones. Order is preserved and no grant exceeds its request.
 */
export function allocateScrollbackBytes(
  demands: readonly ScrollbackDemand[],
  budget: number,
  floor = SCROLLBACK_FLOOR_BYTES,
): number[] {
  const kept = demands.map(({ request, held }) =>
    Math.min(request, Math.max(Math.min(request, floor), held)),
  );
  const grants = [...kept];
  let remaining = budget - kept.reduce((total, bytes) => total + bytes, 0);
  if (remaining <= 0) return grants;

  const order = demands
    .map((demand, index) => ({ headroom: demand.request - kept[index], index }))
    .sort((a, b) => a.headroom - b.headroom || a.index - b.index);
  order.forEach(({ headroom, index }, rank) => {
    const extra = Math.min(
      headroom,
      Math.floor(remaining / (order.length - rank)),
    );
    grants[index] += extra;
    remaining -= extra;
  });
  return grants;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
