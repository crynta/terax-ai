export const LINK_CHIP_HEIGHT = 30;
const GAP = 4;
const EDGE = 8;
/** Generous chip width for edge clamping; the real chip is usually narrower. */
const CHIP_WIDTH_ESTIMATE = 360;

/**
 * Where the link chip sits: just above the link, or below it when the link is
 * near the top of the window, clamped inside the viewport horizontally.
 */
export function chipPlacement(
  rect: { left: number; top: number; bottom: number },
  viewportWidth: number,
): { left: number; top: number; below: boolean } {
  const below = rect.top - LINK_CHIP_HEIGHT - GAP < EDGE;
  const top = below ? rect.bottom + GAP : rect.top - LINK_CHIP_HEIGHT - GAP;
  const maxLeft = Math.max(EDGE, viewportWidth - CHIP_WIDTH_ESTIMATE - EDGE);
  const left = Math.min(Math.max(EDGE, rect.left), maxLeft);
  return { left, top, below };
}
