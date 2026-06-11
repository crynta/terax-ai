import type { SpaceMeta } from "./store";

// Decorative per-space accent hues, distinct from the theme primary. Tuned to
// read on both light and dark surfaces. Indexed by SpaceMeta.color (opt-in).
export const SPACE_COLORS = [
  "oklch(0.62 0.17 254)", // blue
  "oklch(0.60 0.18 296)", // violet
  "oklch(0.65 0.16 162)", // emerald
  "oklch(0.74 0.16 78)", // amber
  "oklch(0.64 0.20 18)", // rose
  "oklch(0.68 0.13 212)", // cyan
  "oklch(0.68 0.18 44)", // orange
  "oklch(0.66 0.19 350)", // pink
] as const;

export function accentFor(space: Pick<SpaceMeta, "color">): string {
  const c = space.color;
  if (c != null && c >= 0 && c < SPACE_COLORS.length) return SPACE_COLORS[c];
  return "var(--primary)";
}

export function spaceInitial(name: string): string {
  const ch = name.trim()[0];
  return ch ? ch.toUpperCase() : "?";
}
