export const MIN_COMPOSER_HEIGHT = 96;
export const DEFAULT_COMPOSER_HEIGHT = 152;
export const MAX_COMPOSER_HEIGHT = 360;

export function clampComposerHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_COMPOSER_HEIGHT;
  return Math.min(
    MAX_COMPOSER_HEIGHT,
    Math.max(MIN_COMPOSER_HEIGHT, Math.round(height)),
  );
}
