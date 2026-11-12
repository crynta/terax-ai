import { describe, expect, it } from "vitest";
import { dropZoneAt, zoneSplit } from "./dropZone";

describe("dropZoneAt", () => {
  it("stacks in the middle and splits near the nearest edge", () => {
    expect(dropZoneAt(0.5, 0.5)).toBe("stack");
    expect(dropZoneAt(0.1, 0.5)).toBe("left");
    expect(dropZoneAt(0.9, 0.5)).toBe("right");
    expect(dropZoneAt(0.5, 0.05)).toBe("top");
    expect(dropZoneAt(0.5, 0.95)).toBe("bottom");
    expect(dropZoneAt(0.1, 0.05)).toBe("top");
  });
});

it("maps edges to the split they create", () => {
  expect(zoneSplit("left")).toEqual({ dir: "row", side: "before" });
  expect(zoneSplit("right")).toEqual({ dir: "row", side: "after" });
  expect(zoneSplit("top")).toEqual({ dir: "col", side: "before" });
  expect(zoneSplit("bottom")).toEqual({ dir: "col", side: "after" });
});
