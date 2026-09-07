import { describe, expect, it } from "vitest";

import { shouldSuppressTerminalContextMenu } from "./mouseTracking";

describe("shouldSuppressTerminalContextMenu", () => {
  it("suppresses the native menu while terminal mouse reporting is active", () => {
    expect(shouldSuppressTerminalContextMenu("x10")).toBe(true);
    expect(shouldSuppressTerminalContextMenu("vt200")).toBe(true);
    expect(shouldSuppressTerminalContextMenu("drag")).toBe(true);
    expect(shouldSuppressTerminalContextMenu("any")).toBe(true);
  });

  it("keeps the native menu available outside terminal mouse reporting", () => {
    expect(shouldSuppressTerminalContextMenu("none")).toBe(false);
    expect(shouldSuppressTerminalContextMenu(null)).toBe(false);
    expect(shouldSuppressTerminalContextMenu(undefined)).toBe(false);
  });
});
