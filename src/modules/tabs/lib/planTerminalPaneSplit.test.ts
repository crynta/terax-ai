import { describe, expect, it } from "vitest";
import { findLeafCwd } from "@/modules/terminal";
import { planTerminalPaneSplit, type TerminalTab } from "./useTabs";

const terminal: TerminalTab = {
  id: 1,
  kind: "terminal",
  spaceId: "space-b",
  title: "shell-a",
  cwd: "/shell-a",
  paneTree: { kind: "leaf", id: 2, cwd: "/shell-a" },
  activeLeafId: 2,
};

describe("planTerminalPaneSplit", () => {
  it("seeds the new leaf from the owning Space root", () => {
    const plan = planTerminalPaneSplit(terminal, "row", "/space-b", () => 3);

    expect(plan?.tab.activeLeafId).toBe(3);
    expect(findLeafCwd(plan?.tab.paneTree ?? terminal.paneTree, 2)).toBe(
      "/shell-a",
    );
    expect(findLeafCwd(plan?.tab.paneTree ?? terminal.paneTree, 3)).toBe(
      "/space-b",
    );
  });
});
