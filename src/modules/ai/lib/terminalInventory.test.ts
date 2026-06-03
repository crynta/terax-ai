import { describe, expect, it } from "vitest";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  buildTerminalInventory,
  redactTerminalInventory,
  resolveTerminalTarget,
} from "./terminalInventory";
import type { TerminalTab } from "@/modules/tabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 2, cwd: "/Users/me/proj" },
        { kind: "leaf", id: 4, cwd: "/Users/me/proj/api" },
      ],
    },
    activeLeafId: 4,
    cwd: "/Users/me/proj/api",
    workspace: LOCAL_WORKSPACE,
    workspaceNonce: 0,
    ...over,
  };
}

describe("buildTerminalInventory", () => {
  it("lists all terminal tabs and their panes", () => {
    const inventory = buildTerminalInventory(
      [
        terminalTab(),
        {
          id: 9,
          kind: "editor",
          title: "notes.ts",
          path: "/tmp/notes.ts",
          dirty: false,
          preview: false,
          workspace: LOCAL_WORKSPACE,
        },
      ],
      9,
    );

    expect(inventory.activeTabId).toBe(9);
    expect(inventory.activeTerminalTabId).toBeNull();
    expect(inventory.tabs).toHaveLength(1);
    expect(inventory.tabs[0]).toMatchObject({
      tabId: 1,
      active: false,
      private: false,
      activeLeafId: 4,
      leafIds: [2, 4],
      cwd: "/Users/me/proj/api",
    });
    expect(inventory.tabs[0].leaves).toEqual([
      { leafId: 2, cwd: "/Users/me/proj", active: false },
      { leafId: 4, cwd: "/Users/me/proj/api", active: true },
    ]);
  });
});

describe("resolveTerminalTarget", () => {
  it("uses the active terminal leaf by default", () => {
    const inventory = buildTerminalInventory([terminalTab()], 1);
    const target = resolveTerminalTarget(inventory, {});

    expect(target).toMatchObject({
      ok: true,
      target: {
        tab: { tabId: 1 },
        leafId: 4,
      },
    });
  });

  it("can target a specific tab or leaf", () => {
    const inventory = buildTerminalInventory([terminalTab()], 1);
    expect(resolveTerminalTarget(inventory, { tabId: 1 })).toMatchObject({
      ok: true,
      target: { leafId: 4 },
    });
    expect(resolveTerminalTarget(inventory, { leafId: 2 })).toMatchObject({
      ok: true,
      target: { leafId: 2 },
    });
  });

  it("redacts private terminal details", () => {
    const inventory = buildTerminalInventory(
      [terminalTab({ private: true })],
      1,
    );
    const redacted = redactTerminalInventory(inventory);

    expect(redacted.tabs[0]).toMatchObject({
      private: true,
      cwd: null,
      activeLeafId: null,
      leafIds: [],
      leaves: [],
    });
    expect(redacted.activeTerminalLeafId).toBeNull();
  });
});
