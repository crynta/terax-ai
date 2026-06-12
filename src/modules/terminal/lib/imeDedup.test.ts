import { describe, expect, it } from "vitest";

import { createImeDedup } from "./imeDedup";

describe("createImeDedup", () => {
  it("passes the first exact match within the window", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1050)).toBe(false);
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

  it("drops only after the first matching write emitted", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1050)).toBe(false);
    expect(dedup.shouldDrop("我想要做一個功能", 1060)).toBe(true);
  });

  it("does not consume the guard for a non-matching write within the window", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("different", 1050)).toBe(false);
    expect(dedup.shouldDrop("我想要做一個功能", 1060)).toBe(false);
    expect(dedup.shouldDrop("我想要做一個功能", 1070)).toBe(true);
  });

  it("flushes pending armed data when never emitted", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.flushPending(1050)).toBe("我想要做一個功能");
    expect(dedup.shouldDrop("我想要做一個功能", 1060)).toBe(true);
  });

  it("does not flush pending data after it already emitted", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.shouldDrop("我想要做一個功能", 1050)).toBe(false);
    expect(dedup.flushPending(1060)).toBeNull();
  });

  it("does not flush pending data outside the window", () => {
    const dedup = createImeDedup();
    dedup.arm("我想要做一個功能", 1000);
    expect(dedup.flushPending(1101)).toBeNull();
  });
});
