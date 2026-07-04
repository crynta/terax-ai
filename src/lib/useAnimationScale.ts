import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type AnimationSpeed,
  clampAnimationCustom,
} from "@/modules/settings/store";
import { useEffect } from "react";

export const ANIMATION_SPEED_FACTORS: Record<
  Exclude<AnimationSpeed, "custom">,
  number
> = {
  off: 0,
  fast: 0.5,
  normal: 1,
  slow: 1.6,
};

/** Duration multiplier read by animated components: 250ms base * factor. */
export function animationScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--terax-anim",
  );
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 1;
}

/** Reactive numeric factor — for JS timings that must match CSS animations. */
export function useAnimationScaleFactor(): number {
  const speed = usePreferencesStore((s) => s.animationSpeed);
  const custom = usePreferencesStore((s) => s.animationSpeedCustom);
  return speed === "custom"
    ? clampAnimationCustom(custom)
    : (ANIMATION_SPEED_FACTORS[speed] ?? 1);
}

/** Mirrors the animationSpeed preference into the --terax-anim CSS var. */
export function useAnimationScale(): void {
  const speed = usePreferencesStore((s) => s.animationSpeed);
  const custom = usePreferencesStore((s) => s.animationSpeedCustom);
  useEffect(() => {
    const factor =
      speed === "custom"
        ? clampAnimationCustom(custom)
        : (ANIMATION_SPEED_FACTORS[speed] ?? 1);
    document.documentElement.style.setProperty("--terax-anim", String(factor));
  }, [speed, custom]);
}
