import { describe, it, expect } from "vitest";

describe("videoThumbnail (unit)", () => {
  it("exports extractVideoThumbnail function", async () => {
    const mod = await import("./videoThumbnail");
    expect(typeof mod.extractVideoThumbnail).toBe("function");
  });

  it("exports extractVideoStoryboard function", async () => {
    const mod = await import("./videoThumbnail");
    expect(typeof mod.extractVideoStoryboard).toBe("function");
  });
});
