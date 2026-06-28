import { describe, expect, it } from "vitest";
import { dragPointCandidates } from "./useTerminalFileDrop";

describe("dragPointCandidates", () => {
  it("keeps logical coordinates unchanged", () => {
    expect(
      dragPointCandidates(120, 80, { devicePixelRatio: 1 }),
    ).toStrictEqual([{ x: 120, y: 80 }]);
  });

  it("also tries physical coordinates normalized by device pixel ratio", () => {
    expect(
      dragPointCandidates(800, 400, { devicePixelRatio: 2 }),
    ).toStrictEqual([
      { x: 800, y: 400 },
      { x: 400, y: 200 },
    ]);
  });
});
