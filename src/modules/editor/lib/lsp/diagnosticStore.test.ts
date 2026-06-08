import { describe, expect, it } from "vitest";
import { useLspDiagnosticStore } from "./diagnosticStore";

describe("diagnosticStore", () => {
  it("counts errors and warnings separately", () => {
    useLspDiagnosticStore.getState().setForPath("C:/proj/main.rs", [
      { severity: 1 },
      { severity: 1 },
      { severity: 2 },
    ]);
    const counts =
      useLspDiagnosticStore.getState().byPath["c:/proj/main.rs"];
    expect(counts).toEqual({ errors: 2, warnings: 1 });
  });

  it("clears entry when diagnostics become empty", () => {
    useLspDiagnosticStore.getState().setForPath("C:/proj/a.ts", [
      { severity: 1 },
    ]);
    useLspDiagnosticStore.getState().setForPath("C:/proj/a.ts", []);
    expect(
      useLspDiagnosticStore.getState().byPath["c:/proj/a.ts"],
    ).toBeUndefined();
  });
});
