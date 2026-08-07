import { describe, expect, it, vi } from "vitest";
import { refreshAfterWebglDispose } from "./rendererPool";

describe("refreshAfterWebglDispose", () => {
  it("repaints every terminal row after WebGL disposal", () => {
    const refresh = vi.fn();

    refreshAfterWebglDispose({ rows: 42, refresh });

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(0, 41);
  });
});
