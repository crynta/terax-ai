import { describe, expect, it } from "vitest";
import { surfaceFrame, surfaceOwnsLayer } from "./surfaceFrame";

const base = {
  animated: true,
  resizing: false,
  documentHidden: false,
  inactive: false,
  hasStill: false,
};

describe("surfaceFrame", () => {
  it("keeps static images live in every state", () => {
    for (const resizing of [false, true]) {
      for (const inactive of [false, true]) {
        expect(
          surfaceFrame({
            ...base,
            animated: false,
            resizing,
            inactive,
            documentHidden: true,
          }),
        ).toBe("live");
      }
    }
  });

  it("animates while the window is active", () => {
    expect(surfaceFrame(base)).toBe("live");
    expect(surfaceFrame({ ...base, hasStill: true })).toBe("live");
  });

  it("hides during resize and while the document is hidden, as before", () => {
    expect(surfaceFrame({ ...base, resizing: true })).toBe("hidden");
    expect(surfaceFrame({ ...base, documentHidden: true })).toBe("hidden");
    expect(
      surfaceFrame({
        ...base,
        documentHidden: true,
        inactive: true,
        hasStill: true,
      }),
    ).toBe("hidden");
  });

  it("freezes on a still frame when merely unfocused, never blanking a visible window", () => {
    expect(surfaceFrame({ ...base, inactive: true, hasStill: true })).toBe(
      "still",
    );
  });

  it("keeps animating until the still frame is ready so the freeze is seamless", () => {
    expect(surfaceFrame({ ...base, inactive: true, hasStill: false })).toBe(
      "live",
    );
  });
});

describe("surfaceOwnsLayer", () => {
  it("gives a static, unblurred image no layer of its own", () => {
    expect(
      surfaceOwnsLayer({ animated: false, blurActive: false, frame: "live" }),
    ).toBe(false);
  });

  it("composites the blur filter, not the resize that suspends it", () => {
    expect(
      surfaceOwnsLayer({ animated: false, blurActive: true, frame: "live" }),
    ).toBe(true);
    expect(
      surfaceOwnsLayer({ animated: false, blurActive: false, frame: "live" }),
    ).toBe(false);
  });

  it("composites animated frames except while they are hidden", () => {
    for (const frame of ["live", "still"] as const)
      expect(
        surfaceOwnsLayer({ animated: true, blurActive: false, frame }),
      ).toBe(true);
    expect(
      surfaceOwnsLayer({ animated: true, blurActive: false, frame: "hidden" }),
    ).toBe(false);
  });
});
