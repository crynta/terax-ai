import { describe, expect, it } from "vitest";
import {
  shouldOfferAskFromPointer,
  suppressNativeImageContextMenu,
} from "./nativeContextMenu";

describe("suppressNativeImageContextMenu", () => {
  it("blocks the native menu on images only", () => {
    const image = new Event("contextmenu", { cancelable: true });
    Object.defineProperty(image, "target", {
      value: { tagName: "IMG" },
    });
    suppressNativeImageContextMenu(image);
    expect(image.defaultPrevented).toBe(true);

    const other = new Event("contextmenu", { cancelable: true });
    Object.defineProperty(other, "target", {
      value: { tagName: "DIV" },
    });
    suppressNativeImageContextMenu(other);
    expect(other.defaultPrevented).toBe(false);
  });
});

describe("shouldOfferAskFromPointer", () => {
  it("offers Ask only on a primary click", () => {
    expect(
      shouldOfferAskFromPointer({ button: 0, ctrlKey: false }, false),
    ).toBe(true);
    expect(
      shouldOfferAskFromPointer({ button: 2, ctrlKey: false }, false),
    ).toBe(false);
    expect(shouldOfferAskFromPointer({ button: 0, ctrlKey: true }, true)).toBe(
      false,
    );
    expect(shouldOfferAskFromPointer({ button: 0, ctrlKey: true }, false)).toBe(
      true,
    );
  });
});
