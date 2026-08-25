import { beforeEach, describe, expect, it } from "vitest";
import { useDiagnosticsStore } from "./diagnosticsStore";

function report(path: string, errors: number | null, warnings = 0) {
  useDiagnosticsStore
    .getState()
    .report(path, errors === null ? null : { errors, warnings });
}

describe("diagnostics count store", () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({ byPath: {} });
  });

  it("keeps counts per path", () => {
    report("/a.ts", 1, 2);
    report("/b.ts", 3);

    expect(useDiagnosticsStore.getState().byPath).toEqual({
      "/a.ts": { errors: 1, warnings: 2 },
      "/b.ts": { errors: 3, warnings: 0 },
    });
  });

  it("skips identical reports so subscribers stay quiet", () => {
    report("/a.ts", 1, 2);
    const before = useDiagnosticsStore.getState().byPath;

    report("/a.ts", 1, 2);

    expect(useDiagnosticsStore.getState().byPath).toBe(before);
  });

  it("replaces counts when they change", () => {
    report("/a.ts", 1);
    report("/a.ts", 0, 4);

    expect(useDiagnosticsStore.getState().byPath["/a.ts"]).toEqual({
      errors: 0,
      warnings: 4,
    });
  });

  it("drops the entry on a null report", () => {
    report("/a.ts", 1);
    report("/a.ts", null);

    expect(useDiagnosticsStore.getState().byPath["/a.ts"]).toBeUndefined();
  });

  it("ignores null reports for paths with no entry", () => {
    const before = useDiagnosticsStore.getState().byPath;

    report("/missing.ts", null);

    expect(useDiagnosticsStore.getState().byPath).toBe(before);
  });
});
