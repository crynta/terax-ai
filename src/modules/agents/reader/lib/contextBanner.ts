/** Context use at which the Reader offers to compact the conversation. */
export const COMPACT_WARN_PERCENT = 85;
/** Context use at which the banner turns red. */
export const COMPACT_HIGH_PERCENT = 95;

export type CompactBanner = { tone: "warn" | "high"; percent: number } | null;

/**
 * The "Context N% full — Compact" banner for `percent`, or null below the
 * threshold. A banner dismissed at `dismissedAt` stays hidden until context
 * grows another 5 points.
 */
export function compactBanner(
  percent: number | null,
  dismissedAt: number | null = null,
): CompactBanner {
  if (percent === null || !Number.isFinite(percent)) return null;
  const p = Math.round(percent);
  if (p < COMPACT_WARN_PERCENT) return null;
  if (dismissedAt !== null && p < dismissedAt + 5) return null;
  return { tone: p >= COMPACT_HIGH_PERCENT ? "high" : "warn", percent: p };
}

/** The `/compact` command, with optional one-line instructions. */
export function compactCommand(instructions: string): string {
  const one = instructions.replace(/\s+/g, " ").trim();
  return one ? `/compact ${one}` : "/compact";
}
