import { describe, expect, it } from "vitest";
import { formatNotificationDestination } from "./notificationDestination";

describe("formatNotificationDestination", () => {
  it("returns an uppercase space label and trimmed tab title when both exist", () => {
    expect(
      formatNotificationDestination({
        spaceName: "Main",
        tabTitle: " Space_Terax ",
      }),
    ).toEqual({
      spaceLabel: "MAIN",
      tabTitle: "Space_Terax",
      hasDestination: true,
    });
  });

  it("falls back to tab title only", () => {
    expect(
      formatNotificationDestination({ tabTitle: "lesson-04" }),
    ).toEqual({
      tabTitle: "lesson-04",
      hasDestination: true,
    });
  });

  it("falls back to space only", () => {
    expect(formatNotificationDestination({ spaceName: "School" })).toEqual({
      spaceLabel: "SCHOOL",
      hasDestination: true,
    });
  });

  it("reports no destination when both values are blank", () => {
    expect(
      formatNotificationDestination({ spaceName: " ", tabTitle: "" }),
    ).toEqual({ hasDestination: false });
  });
});
