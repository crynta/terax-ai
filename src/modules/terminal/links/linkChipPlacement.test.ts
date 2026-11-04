import { describe, expect, it } from "vitest";
import { chipPlacement, LINK_CHIP_HEIGHT } from "./linkChipPlacement";

describe("chipPlacement", () => {
  it("sits just above the link", () => {
    expect(chipPlacement({ left: 100, top: 200, bottom: 220 }, 1600)).toEqual({
      left: 100,
      top: 200 - LINK_CHIP_HEIGHT - 4,
      below: false,
    });
  });

  it("drops below a link near the top of the window", () => {
    const place = chipPlacement({ left: 100, top: 10, bottom: 30 }, 1600);
    expect(place).toMatchObject({ top: 34, below: true });
  });

  it("stays inside the viewport horizontally", () => {
    expect(
      chipPlacement({ left: 1500, top: 200, bottom: 220 }, 1600).left,
    ).toBe(1600 - 360 - 8);
    expect(chipPlacement({ left: -20, top: 200, bottom: 220 }, 1600).left).toBe(
      8,
    );
  });
});
