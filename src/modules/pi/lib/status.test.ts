import { describe, expect, it } from "vitest";
import { getPiStatusView } from "./status";

describe("getPiStatusView", () => {
  it("describes the disconnected state", () => {
    expect(getPiStatusView({ phase: "disconnected", detail: null })).toEqual({
      label: "Not connected",
      tone: "muted",
      canStart: true,
      canStop: false,
    });
  });

  it("describes the ready placeholder state", () => {
    expect(
      getPiStatusView({ phase: "ready", detail: "Placeholder Pi runtime" }),
    ).toEqual({
      label: "Ready",
      tone: "success",
      canStart: false,
      canStop: true,
    });
  });
});
