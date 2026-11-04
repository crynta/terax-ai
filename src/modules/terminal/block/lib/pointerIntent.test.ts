import { describe, expect, it } from "vitest";
import { createPointerIntent } from "./pointerIntent";

describe("createPointerIntent", () => {
  it("treats the first position as a baseline, not intent", () => {
    const moved = createPointerIntent();
    expect(moved(10, 20)).toBe(false);
  });

  it("ignores repeats of the resting position (content scrolled underneath)", () => {
    const moved = createPointerIntent();
    moved(10, 20);
    expect(moved(10, 20)).toBe(false);
    expect(moved(10, 20)).toBe(false);
  });

  it("reports a real move and then rests at the new position", () => {
    const moved = createPointerIntent();
    moved(10, 20);
    expect(moved(10, 21)).toBe(true);
    expect(moved(10, 21)).toBe(false);
    expect(moved(11, 21)).toBe(true);
  });
});
