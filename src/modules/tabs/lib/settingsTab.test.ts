import { describe, expect, it } from "vitest";
import {
  applyOpenSettingsTab,
  type SettingsSection,
  type Tab,
} from "./useTabs";

function terminalTab(): Tab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  };
}

describe("applyOpenSettingsTab", () => {
  it("creates one settings tab and reuses it for later sections", () => {
    let nextId = 3;
    const first = applyOpenSettingsTab([terminalTab()], () => nextId++, "models");

    expect(first.activeId).toBe(3);
    expect(first.tabs).toHaveLength(2);
    expect(first.tabs[1]).toMatchObject({
      id: 3,
      kind: "settings",
      title: "Settings",
      activeSection: "models" satisfies SettingsSection,
    });

    const second = applyOpenSettingsTab(
      first.tabs,
      () => nextId++,
      "shortcuts",
    );

    expect(second.activeId).toBe(3);
    expect(second.tabs).toHaveLength(2);
    expect(second.tabs[1]).toMatchObject({
      id: 3,
      kind: "settings",
      activeSection: "shortcuts" satisfies SettingsSection,
    });
  });
});
