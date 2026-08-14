import { describe, expect, it } from "vitest";
import {
  type CloseManyHazards,
  hasCloseManyHazards,
  hasNewCloseManyHazards,
} from "./tabCloseGuards";

function hazards(
  dirtyIds: number[] = [],
  busyLeafIds: number[] = [],
): CloseManyHazards {
  return { dirtyIds, busyLeafIds };
}

describe("close-many hazards", () => {
  it("requires a guard for dirty editors or busy terminal leaves", () => {
    expect(hasCloseManyHazards(hazards())).toBe(false);
    expect(hasCloseManyHazards(hazards([2]))).toBe(true);
    expect(hasCloseManyHazards(hazards([], [20]))).toBe(true);
  });

  it("accepts confirmation when the acknowledged hazards are unchanged", () => {
    const acknowledged = hazards([2], [20]);
    expect(hasNewCloseManyHazards(acknowledged, hazards([2], [20]))).toBe(
      false,
    );
  });

  it("accepts confirmation when acknowledged hazards have cleared", () => {
    const acknowledged = hazards([2, 3], [20, 30]);
    expect(hasNewCloseManyHazards(acknowledged, hazards([2], [30]))).toBe(
      false,
    );
  });

  it("requires another confirmation for a newly dirty editor", () => {
    expect(hasNewCloseManyHazards(hazards([2]), hazards([2, 3]))).toBe(true);
  });

  it("requires another confirmation for a newly busy terminal leaf", () => {
    expect(
      hasNewCloseManyHazards(hazards([], [20]), hazards([], [20, 30])),
    ).toBe(true);
  });
});
