import { afterEach, describe, expect, it, vi } from "vitest";
import { traceEager } from "../../../../scripts/eager-graph.mjs";
import { terminalDiagnosticsEnabled } from "@/modules/terminal/lib/terminalDiagnosticsEnabled";

describe("terminal diagnostic startup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("loads independently of xterm and its renderer pool", () => {
    const graph = traceEager(
      "src/modules/terminal/lib/terminalDiagnostics.ts",
      ["@xterm"],
    );
    expect([...graph.hits.keys()]).toEqual([]);
  });

  it("has no release startup work until diagnostics are enabled", () => {
    vi.stubEnv("DEV", false);
    const getItem = vi.fn().mockReturnValue(null);
    vi.stubGlobal("window", { localStorage: { getItem } });
    expect(terminalDiagnosticsEnabled()).toBe(false);
    getItem.mockReturnValue("1");
    expect(terminalDiagnosticsEnabled()).toBe(true);
  });

  it("tolerates webviews that disable local storage", () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("denied");
      },
    });
    expect(terminalDiagnosticsEnabled()).toBe(false);
  });
});
