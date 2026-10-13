import { describe, expect, it } from "vitest";
import { labelFor, paneLabels, splitPaneLabels } from "./tabLabel";
import type { TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(
        terminalTab({
          cwd: "/Users/me/projects/terax-ai",
          customTitle: "Server",
        }),
      ),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

function splitTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return terminalTab({
    cwd: "/code/azeroth",
    paneTree: {
      kind: "split",
      id: 5,
      dir: "row",
      children: [
        { kind: "leaf", id: 2, cwd: "/code/azeroth" },
        {
          kind: "split",
          id: 6,
          dir: "col",
          children: [
            { kind: "leaf", id: 3, cwd: "C:\\code\\CasaFina-CRM" },
            { kind: "leaf", id: 4, cwd: "/code/api" },
          ],
        },
      ],
    },
    activeLeafId: 2,
    ...over,
  });
}

describe("labelFor (split terminal tabs)", () => {
  it("lists every pane name in tree order", () => {
    expect(labelFor(splitTab())).toBe("azeroth | CasaFina-CRM | api");
  });

  it("does not reorder when focus moves to another pane", () => {
    expect(labelFor(splitTab({ activeLeafId: 4, cwd: "/code/api" }))).toBe(
      "azeroth | CasaFina-CRM | api",
    );
  });

  it("prefers a custom title over the pane names", () => {
    expect(labelFor(splitTab({ customTitle: "Server" }))).toBe("Server");
  });

  it("falls back to the tab title for a pane without a cwd", () => {
    const tab = terminalTab({
      title: "shell",
      cwd: "/code/web",
      paneTree: {
        kind: "split",
        id: 5,
        dir: "row",
        children: [
          { kind: "leaf", id: 2 },
          { kind: "leaf", id: 3 },
        ],
      },
      activeLeafId: 2,
    });
    expect(labelFor(tab)).toBe("web | shell");
  });

  it("keeps repeated names so each pane stays visible", () => {
    const tab = terminalTab({
      paneTree: {
        kind: "split",
        id: 5,
        dir: "row",
        children: [
          { kind: "leaf", id: 2, cwd: "/code/api" },
          { kind: "leaf", id: 3, cwd: "/code/api" },
        ],
      },
      activeLeafId: 3,
    });
    expect(labelFor(tab)).toBe("api | api");
  });
});

describe("splitPaneLabels", () => {
  it("returns null for a single-pane tab", () => {
    expect(splitPaneLabels(terminalTab({ cwd: "/code/api" }))).toBeNull();
  });

  it("returns null when a custom title is set", () => {
    expect(splitPaneLabels(splitTab({ customTitle: "Server" }))).toBeNull();
  });

  it("flags only the active pane", () => {
    expect(splitPaneLabels(splitTab({ activeLeafId: 3 }))).toEqual([
      { leafId: 2, name: "azeroth", active: false },
      { leafId: 3, name: "CasaFina-CRM", active: true },
      { leafId: 4, name: "api", active: false },
    ]);
  });
});

describe("paneLabels", () => {
  it("names a single pane from its cwd", () => {
    expect(
      paneLabels(
        terminalTab({ paneTree: { kind: "leaf", id: 2, cwd: "/code/api" } }),
      ),
    ).toEqual([{ leafId: 2, name: "api", active: true }]);
  });
});
