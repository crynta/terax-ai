import { describe, expect, it } from "vitest";
import { shouldReleaseHiddenRenderer } from "./hibernationPolicy";

describe("shouldReleaseHiddenRenderer", () => {
  it("keeps a hidden renderer when hibernation is disabled and a slot exists", () => {
    expect(
      shouldReleaseHiddenRenderer({
        visible: false,
        hasSlot: true,
        hibernationEnabled: false,
      }),
    ).toBe(false);
  });

  it("releases a hidden renderer when hibernation is enabled and a slot exists", () => {
    expect(
      shouldReleaseHiddenRenderer({
        visible: false,
        hasSlot: true,
        hibernationEnabled: true,
      }),
    ).toBe(true);
  });

  it("does not release without a bound slot", () => {
    expect(
      shouldReleaseHiddenRenderer({
        visible: false,
        hasSlot: false,
        hibernationEnabled: true,
      }),
    ).toBe(false);
  });
});
