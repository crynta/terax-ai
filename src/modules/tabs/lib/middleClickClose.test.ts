import { describe, expect, it } from "vitest";
import { shouldCloseTabOnMiddleMouse } from "./middleClickClose";

describe("shouldCloseTabOnMiddleMouse", () => {
  it("closes on middle button when multiple tabs are open", () => {
    expect(shouldCloseTabOnMiddleMouse(1, 2)).toBe(true);
    expect(shouldCloseTabOnMiddleMouse(1, 5)).toBe(true);
  });

  it("does not close the last remaining tab", () => {
    expect(shouldCloseTabOnMiddleMouse(1, 1)).toBe(false);
    expect(shouldCloseTabOnMiddleMouse(1, 0)).toBe(false);
  });

  it("ignores primary and secondary buttons", () => {
    expect(shouldCloseTabOnMiddleMouse(0, 3)).toBe(false);
    expect(shouldCloseTabOnMiddleMouse(2, 3)).toBe(false);
  });
});
