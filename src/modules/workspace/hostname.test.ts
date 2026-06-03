import { describe, expect, it } from "vitest";
import { isLocalHost, normalizeHostName } from "./hostname";

describe("hostname helpers", () => {
  it("normalizes case and .local suffix", () => {
    expect(normalizeHostName("SeanPC.local")).toBe("seanpc");
    expect(normalizeHostName("  SEANPC  ")).toBe("seanpc");
  });

  it("treats unresolved local host as non-match", () => {
    expect(isLocalHost("SeanPC", null)).toBe(false);
    expect(isLocalHost("SeanPC", "")).toBe(false);
  });

  it("matches local host after normalization", () => {
    expect(isLocalHost("SeanPC.local", "seanpc")).toBe(true);
    expect(isLocalHost("seanpc", "SeanPC.local")).toBe(true);
  });
});
