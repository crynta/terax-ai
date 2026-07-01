import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SPACE_ID, type Tab } from "@/modules/tabs";

import {
  createCommandItems,
  type CommandPaletteActionContext,
} from "./commands";

function terminalTab(id: number, leafId: number): Tab {
  return {
    id,
    kind: "terminal",
    title: "Terminal",
    spaceId: DEFAULT_SPACE_ID,
    paneTree: { kind: "leaf", id: leafId },
    activeLeafId: leafId,
  };
}

function editorTab(id: number): Tab {
  return {
    id,
    kind: "editor",
    title: "Editor",
    spaceId: DEFAULT_SPACE_ID,
    path: "/tmp/file.ts",
    dirty: false,
    preview: false,
  };
}

function context(
  tab: Tab,
  overrides: Partial<CommandPaletteActionContext> & {
    toggleTerminalComposer?: () => void;
  } = {},
): CommandPaletteActionContext {
  return {
    tabs: [tab],
    activeId: tab.id,
    searchTarget: null,
    explorerRoot: "/tmp",
    home: "/tmp",
    openNewTab: vi.fn(),
    openNewBlock: vi.fn(),
    openNewPrivate: vi.fn(),
    openNewEditor: vi.fn(),
    openNewPreview: vi.fn(),
    openGitGraph: vi.fn(),
    toggleSourceControl: vi.fn(),
    closeActiveTabOrPane: vi.fn(),
    splitPaneRight: vi.fn(),
    splitPaneDown: vi.fn(),
    focusSearch: vi.fn(),
    focusExplorerSearch: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleAi: vi.fn(),
    askAiSelection: vi.fn(),
    openSettings: vi.fn(),
    openKeyboardShortcuts: vi.fn(),
    spaces: [],
    activeSpaceId: DEFAULT_SPACE_ID,
    openSpacesOverview: vi.fn(),
    newSpace: vi.fn(),
    switchSpace: vi.fn(),
    ...overrides,
  } as CommandPaletteActionContext;
}

describe("createCommandItems", () => {
  it("includes a terminal composer action for terminal tabs", () => {
    const toggleTerminalComposer = vi.fn();
    const items = createCommandItems(
      context(terminalTab(1, 101), { toggleTerminalComposer }),
    );

    const item = items.find((entry) => entry.id === "terminalComposer.toggle");

    expect(item).toMatchObject({
      title: "Open terminal composer",
      group: "Terminal",
      shortcutId: "terminalComposer.toggle",
      disabledReason: undefined,
    });
    item?.run();
    expect(toggleTerminalComposer).toHaveBeenCalledOnce();
  });

  it("disables the terminal composer action outside terminal tabs", () => {
    const items = createCommandItems(context(editorTab(1)));

    expect(
      items.find((entry) => entry.id === "terminalComposer.toggle"),
    ).toMatchObject({
      disabledReason: "No terminal tab",
    });
  });
});
