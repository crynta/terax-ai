import { describe, expect, it } from "vitest";
import { shouldPrewarmPiRuntime } from "./lifecycle";

describe("shouldPrewarmPiRuntime", () => {
  it("prewarms only once for disconnected or error runtimes", () => {
    expect(
      shouldPrewarmPiRuntime({
        attempted: false,
        isBusy: false,
        runtimeState: { phase: "disconnected", detail: null },
      }),
    ).toBe(true);
    expect(
      shouldPrewarmPiRuntime({
        attempted: false,
        isBusy: false,
        runtimeState: { phase: "error", detail: "crashed" },
      }),
    ).toBe(true);
    expect(
      shouldPrewarmPiRuntime({
        attempted: true,
        isBusy: false,
        runtimeState: { phase: "disconnected", detail: null },
      }),
    ).toBe(false);
  });

  it("does not prewarm while already ready, starting, or busy", () => {
    expect(
      shouldPrewarmPiRuntime({
        attempted: false,
        isBusy: false,
        runtimeState: { phase: "ready", detail: null },
      }),
    ).toBe(false);
    expect(
      shouldPrewarmPiRuntime({
        attempted: false,
        isBusy: false,
        runtimeState: { phase: "starting", detail: "Starting Pi" },
      }),
    ).toBe(false);
    expect(
      shouldPrewarmPiRuntime({
        attempted: false,
        isBusy: true,
        runtimeState: { phase: "disconnected", detail: null },
      }),
    ).toBe(false);
  });
});
