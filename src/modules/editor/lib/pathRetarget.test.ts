import { describe, expect, it } from "vitest";
import { consumeRetarget, noteRetarget } from "./pathRetarget";

describe("pathRetarget", () => {
  it("consumes a noted rename exactly once", () => {
    noteRetarget("/a/x.ts", "/a/y.ts");
    expect(consumeRetarget("/a/x.ts", "/a/y.ts")).toBe(true);
    expect(consumeRetarget("/a/x.ts", "/a/y.ts")).toBe(false);
  });

  it("does not match a different path change", () => {
    noteRetarget("/a/x.ts", "/a/y.ts");
    expect(consumeRetarget("/a/x.ts", "/a/z.ts")).toBe(false);
    expect(consumeRetarget("/a/y.ts", "/a/x.ts")).toBe(false);
    expect(consumeRetarget("/a/x.ts", "/a/y.ts")).toBe(true);
  });

  it("two notes, two consumes", () => {
    noteRetarget("/a/x.ts", "/a/y.ts");
    noteRetarget("/a/x.ts", "/a/y.ts");
    expect(consumeRetarget("/a/x.ts", "/a/y.ts")).toBe(true);
    expect(consumeRetarget("/a/x.ts", "/a/y.ts")).toBe(true);
    expect(consumeRetarget("/a/x.ts", "/a/y.ts")).toBe(false);
  });

  it("ignores a no-op rename", () => {
    noteRetarget("/a/x.ts", "/a/x.ts");
    expect(consumeRetarget("/a/x.ts", "/a/x.ts")).toBe(false);
  });
});
