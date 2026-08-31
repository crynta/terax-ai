import { describe, expect, it, vi } from "vitest";
import { isTerminalSurfaceTarget } from "./terminalSurfaceTarget";

describe("isTerminalSurfaceTarget", () => {
  it("recognizes xterm and Ghostty descendants", () => {
    const terminalTarget = {
      closest: vi.fn(() => ({ terminal: true }) as unknown as Element),
    } as unknown as EventTarget;
    const regularTarget = {
      closest: vi.fn(() => null),
    } as unknown as EventTarget;

    expect(isTerminalSurfaceTarget(terminalTarget)).toBe(true);
    expect(isTerminalSurfaceTarget(regularTarget)).toBe(false);
    expect(isTerminalSurfaceTarget(null)).toBe(false);
  });
});
