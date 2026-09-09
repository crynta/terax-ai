import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_RECLAIM_DELAY_MS,
  WindowPresentationPolicy,
} from "@/modules/terminal/ghostty/WindowPresentationPolicy";

describe("window presentation resource policy", () => {
  afterEach(() => vi.useRealTimers());

  it("pauses immediately but avoids resource churn during repeated desktop switches", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const policy = new WindowPresentationPolicy(publish);
    for (let i = 0; i < 1_000; i++) {
      policy.update(false);
      expect(policy.snapshot()).toEqual({ visible: false, reclaim: false });
      vi.advanceTimersByTime(50);
      policy.update(true);
    }
    expect(policy.reclamations).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    policy.dispose();
  });

  it("reclaims once after sustained occlusion; duplicate events do not extend retention", () => {
    vi.useFakeTimers();
    const policy = new WindowPresentationPolicy(vi.fn());
    policy.update(false);
    vi.advanceTimersByTime(1_000);
    policy.update(false);
    vi.advanceTimersByTime(PRESENTATION_RECLAIM_DELAY_MS - 1_000);
    expect(policy.snapshot()).toEqual({ visible: false, reclaim: true });
    policy.update(false);
    expect(policy.reclamations).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    policy.dispose();
  });

  it("reclaims immediately for sleep and cancels outstanding timers on dispose", () => {
    vi.useFakeTimers();
    const policy = new WindowPresentationPolicy(vi.fn());
    policy.update(false);
    policy.update(false, true);
    expect(policy.snapshot().reclaim).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    policy.update(true);
    policy.update(false);
    policy.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
