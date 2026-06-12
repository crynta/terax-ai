import { describe, expect, it } from "vitest";

import { createImeDedup } from "./imeDedup";

describe("createImeDedup", () => {
  it("drops an exact duplicate within the window", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1050)).toBe(true);
  });

  it("does not drop a write outside the window", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1101)).toBe(false);
  });

  it("does not drop legitimate repeated identical input when never armed", () => {
    const dedup = createImeDedup();
    expect(dedup.shouldDrop("a", 1000)).toBe(false);
    expect(dedup.shouldDrop("a", 1001)).toBe(false);
  });

  it("does not arm on empty data", () => {
    const dedup = createImeDedup();
    dedup.arm("", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1050)).toBe(false);
  });

  it("drops only once", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1050)).toBe(true);
    expect(dedup.shouldDrop("我想要做一個功能", 1060)).toBe(false);
  });

  it("does not consume the guard for a non-matching write within the window", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("different", 1050)).toBe(false);
    expect(dedup.shouldDrop("我想要做一個功能", 1060)).toBe(true);
  });
});
