import { describe, expect, it } from "vitest";
import { type Tab, upsertPiWorkspaceTab } from "./useTabs";

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  title: "terminal",
  paneTree: { kind: "leaf", id: 1 },
  activeLeafId: 1,
};

describe("pi workspace tabs", () => {
  it("opens a Code workspace tab when none exists", () => {
    const result = upsertPiWorkspaceTab([terminalTab], 2);

    expect(result.tabs).toEqual([
      terminalTab,
      { id: 2, kind: "pi-workspace", title: "Code" },
    ]);
    expect(result.activeId).toBe(2);
  });

  it("dedupes the Code workspace tab", () => {
    const existing: Tab = { id: 2, kind: "pi-workspace", title: "Code" };
    const result = upsertPiWorkspaceTab([terminalTab, existing], 3);

    expect(result.tabs).toEqual([terminalTab, existing]);
    expect(result.activeId).toBe(2);
  });
});
