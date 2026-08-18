import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import {
  type CommandPaletteActionContext,
  createCommandItems,
} from "./commands";

function terminalTab(id: number, paneCount = 1): Tab {
  const leaves = Array.from({ length: paneCount }, (_, index) => ({
    kind: "leaf" as const,
    id: id * 10 + index,
  }));
  const paneTree =
    leaves.length === 1
      ? leaves[0]
      : {
          kind: "split" as const,
          id: id * 100,
          dir: "row" as const,
          children: leaves,
        };
  return {
    id,
    kind: "terminal",
    spaceId: "s",
    title: "shell",
    paneTree,
    activeLeafId: id * 10,
  } as unknown as Tab;
}

function baseContext(
  over: Partial<CommandPaletteActionContext> = {},
): CommandPaletteActionContext {
  const noop = () => {};
  return {
    tabs: [terminalTab(1)],
    activeId: 1,
    searchTarget: "content" as never,
    explorerRoot: "/workspace",
    home: "/home/me",
    spaces: [],
    activeSpaceId: null,
    openNewTab: noop,
    openNewBlock: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openNewPreview: noop,
    openGitGraph: noop,
    toggleSourceControl: noop,
    closeActiveTabOrPane: noop,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    toggleAi: noop,
    askAiSelection: noop,
    openSettings: noop,
    openKeyboardShortcuts: noop,
    openSpacesOverview: noop,
    newSpace: noop,
    switchSpace: noop,
    ...over,
  };
}

function reasonById(over: Partial<CommandPaletteActionContext>, id: string) {
  const item = createCommandItems(baseContext(over)).find((i) => i.id === id);
  if (!item) throw new Error(`no command item ${id}`);
  return item.disabledReason;
}

describe("createCommandItems", () => {
  it("enables split on a terminal tab below the pane limit", () => {
    const tabs = [terminalTab(1, 7)];
    expect(reasonById({ tabs }, "pane.splitRight")).toBeUndefined();
    expect(reasonById({ tabs }, "pane.splitDown")).toBeUndefined();
  });

  it("disables split at the eight-pane limit", () => {
    const tabs = [terminalTab(1, 8)];
    expect(reasonById({ tabs }, "pane.splitRight")).toBe("Pane limit");
    expect(reasonById({ tabs }, "pane.splitDown")).toBe("Pane limit");
  });

  it("disables split when there is no terminal tab", () => {
    const editorTab = { ...terminalTab(1), kind: "editor" } as unknown as Tab;
    expect(reasonById({ tabs: [editorTab] }, "pane.splitRight")).toBe(
      "No terminal tab",
    );
  });

  it("disables close on the last tab with a single pane", () => {
    expect(reasonById({}, "tab.close")).toBe("Last tab");
  });

  it("enables close when more than one tab is open", () => {
    expect(
      reasonById({ tabs: [terminalTab(1), terminalTab(2)] }, "tab.close"),
    ).toBeUndefined();
  });

  it("disables content search when there is no searchable view", () => {
    expect(reasonById({ searchTarget: null as never }, "search.focus")).toBe(
      "No searchable view",
    );
  });

  it("disables explorer search when there is no workspace root", () => {
    expect(reasonById({ explorerRoot: null }, "explorer.search")).toBe(
      "No workspace root",
    );
  });

  it("marks the active space as the current one", () => {
    const reason = reasonById(
      { spaces: [{ id: "sp1", name: "One" }], activeSpaceId: "sp1" },
      "spaces.switch.sp1",
    );
    expect(reason).toBe("Current space");
  });
});
