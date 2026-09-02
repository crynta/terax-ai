import { describe, expect, it } from "vitest";
import { defaultTerminalWebglEnabled } from "./store";

describe("defaultTerminalWebglEnabled", () => {
  it("uses the DOM renderer by default on Linux", () => {
    expect(defaultTerminalWebglEnabled(true)).toBe(false);
  });

  it("keeps WebGL enabled by default on other platforms", () => {
    expect(defaultTerminalWebglEnabled(false)).toBe(true);
  });
});
