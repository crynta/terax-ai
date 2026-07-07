import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENCLICKY_AI_TOOLS_STORAGE_KEY } from "./featureGates";
import { availableSlashCommands, tryRunSlashCommand } from "./slashCommands";

function setGate(value: string | null) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) =>
        key === OPENCLICKY_AI_TOOLS_STORAGE_KEY ? value : null,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slashCommands experimental gates", () => {
  it("hides 3D generation unless openclicky AI tools are enabled", () => {
    setGate(null);
    expect(
      availableSlashCommands().map((command) => command.name),
    ).not.toContain("3d");

    setGate("true");
    expect(availableSlashCommands().map((command) => command.name)).toContain(
      "3d",
    );
  });

  it("does not send a 3D prompt when the experimental gate is disabled", () => {
    setGate(null);

    expect(tryRunSlashCommand("/3d a tiny robot")).toMatchObject({
      kind: "handled",
    });
  });
});
