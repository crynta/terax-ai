import { describe, expect, it } from "vitest";
import { grantPolicy, type GlLeafState } from "./glContextPool";

// Pure GL-grant policy: no canvas, no DOM. Locks the bounded-resource invariant
// that replaces the old POOL_MAX_SIZE eviction — the scarce thing is now the
// WebGL context, capped at MAX_GL_CONTEXTS, and the policy must NEVER exceed it.

const leaf = (
  leafId: number,
  visible: boolean,
  isTop: boolean,
): GlLeafState => ({ leafId, visible, isTop });

describe("grantPolicy — GL context cap", () => {
  it("grants nothing to hidden leaves", () => {
    const granted = grantPolicy(
      [leaf(1, false, false), leaf(2, false, true)],
      5,
    );
    expect(granted.size).toBe(0);
  });

  it("grants every visible leaf when under cap", () => {
    const granted = grantPolicy(
      [leaf(1, true, true), leaf(2, true, false), leaf(3, true, false)],
      5,
    );
    expect(granted).toEqual(new Set([1, 2, 3]));
  });

  it("NEVER exceeds the cap (the ~16-context ceiling guard)", () => {
    const leaves: GlLeafState[] = [];
    for (let i = 1; i <= 12; i++) leaves.push(leaf(i, true, i === 1));
    const cap = 5;
    const granted = grantPolicy(leaves, cap);
    expect(granted.size).toBe(cap);
  });

  it("prioritizes TOP (focused) leaves when over cap", () => {
    // 6 visible leaves, cap 2, leaves 5 and 6 are the focused/top panes.
    const leaves = [
      leaf(1, true, false),
      leaf(2, true, false),
      leaf(3, true, false),
      leaf(4, true, false),
      leaf(5, true, true),
      leaf(6, true, true),
    ];
    const granted = grantPolicy(leaves, 2);
    expect(granted).toEqual(new Set([5, 6]));
  });

  it("fills remaining slots with non-top visible leaves deterministically", () => {
    // 1 top + several non-top, cap 3 => top first, then lowest leafIds.
    const leaves = [
      leaf(10, true, false),
      leaf(2, true, false),
      leaf(7, true, true),
      leaf(4, true, false),
    ];
    const granted = grantPolicy(leaves, 3);
    // top=7 guaranteed; remaining 2 slots go to lowest non-top ids: 2, 4.
    expect(granted).toEqual(new Set([7, 2, 4]));
    expect(granted.has(10)).toBe(false);
  });

  it("returns empty set for a non-positive cap", () => {
    expect(grantPolicy([leaf(1, true, true)], 0).size).toBe(0);
  });

  it("ignores hidden leaves even if marked top", () => {
    const granted = grantPolicy(
      [leaf(1, false, true), leaf(2, true, false)],
      5,
    );
    expect(granted).toEqual(new Set([2]));
  });
});
