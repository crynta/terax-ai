import { describe, expect, it } from "vitest";
import { shouldTreatCloseAsTabClose } from "./closeFromPreview";
import { canOptOutOfAppClosePrompt } from "./useAppCloseGuard";

describe("canOptOutOfAppClosePrompt", () => {
  it("offers the opt-out when a running process is the only blocker", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 0, busyTerminal: true }),
    ).toBe(true);
  });

  it("withholds the opt-out whenever unsaved changes are also at stake", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 1, busyTerminal: true }),
    ).toBe(false);
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 2, busyTerminal: false }),
    ).toBe(false);
  });
});

describe("shouldTreatCloseAsTabClose", () => {
  it("treats an iframe with open tabs as tab-close", () => {
    const iframe = {
      tagName: "IFRAME",
      closest: () => null,
    } as unknown as Element;
    expect(shouldTreatCloseAsTabClose(iframe, 2)).toBe(true);
  });

  it("does not remap when focus is outside the preview frame", () => {
    const el = {
      tagName: "BUTTON",
      closest: () => null,
    } as unknown as Element;
    expect(shouldTreatCloseAsTabClose(el, 2)).toBe(false);
  });

  it("does not remap with zero tabs even if an iframe is focused", () => {
    const iframe = {
      tagName: "IFRAME",
      closest: () => null,
    } as unknown as Element;
    expect(shouldTreatCloseAsTabClose(iframe, 0)).toBe(false);
  });

  it("treats focus inside [data-preview-frame] as tab-close", () => {
    const frame = {} as Element;
    const child = {
      tagName: "BUTTON",
      closest: (sel: string) =>
        sel === "[data-preview-frame]" ? frame : null,
    } as unknown as Element;
    expect(shouldTreatCloseAsTabClose(child, 1)).toBe(true);
  });

  it("returns false when activeEl is null", () => {
    expect(shouldTreatCloseAsTabClose(null, 2)).toBe(false);
  });
});
