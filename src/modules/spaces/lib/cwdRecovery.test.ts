import type { Tab } from "@/modules/tabs";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import { describe, expect, it } from "vitest";
import {
  fixBrokenCwds,
  fixBrokenSpaceRoots,
  uniqueCwds,
} from "./cwdRecovery";
import type { SpaceMeta } from "./store";

function leaf(id: number, cwd?: string): PaneNode {
  return { kind: "leaf", id, cwd };
}

function terminalTab(
  id: number,
  cwd: string | undefined,
  paneTree: PaneNode,
): Tab {
  return {
    id,
    kind: "terminal",
    title: "t",
    spaceId: "s1",
    cwd,
    paneTree,
    activeLeafId: id,
  } as Tab;
}

function space(over: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "s1",
    name: "Space",
    root: null,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("uniqueCwds", () => {
  it("includes tab.cwd and leaf cwds", () => {
    const tabs = [
      terminalTab(1, "/tab-cwd", leaf(10, "/leaf-cwd")),
      terminalTab(2, "/tab-cwd", leaf(11, "/other")),
    ];
    expect(uniqueCwds(tabs).sort()).toEqual(
      ["/leaf-cwd", "/other", "/tab-cwd"].sort(),
    );
  });

  it("ignores non-terminal tabs", () => {
    const editor = {
      id: 9,
      kind: "editor",
      title: "e",
      spaceId: "s1",
      path: "/x.ts",
      dirty: false,
      preview: false,
    } as Tab;
    expect(uniqueCwds([editor])).toEqual([]);
  });
});

describe("fixBrokenCwds", () => {
  it("rewrites broken tab and leaf cwds to the fallback", () => {
    const tabs = [
      terminalTab(1, "/gone", leaf(10, "/gone")),
      terminalTab(2, "/ok", leaf(11, "/ok")),
    ];
    fixBrokenCwds(tabs, new Set(["/gone"]), "/home");
    expect(tabs[0].cwd).toBe("/home");
    expect((tabs[0].paneTree as { cwd?: string }).cwd).toBe("/home");
    expect(tabs[1].cwd).toBe("/ok");
  });

  it("clears broken cwds when fallback is null", () => {
    const tabs = [terminalTab(1, "/gone", leaf(10, "/gone"))];
    fixBrokenCwds(tabs, new Set(["/gone"]), null);
    expect(tabs[0].cwd).toBeUndefined();
    expect((tabs[0].paneTree as { cwd?: string }).cwd).toBeUndefined();
  });
});

describe("fixBrokenSpaceRoots", () => {
  it("replaces broken roots and leaves healthy ones alone", () => {
    const spaces = [
      space({ id: "a", root: "/gone" }),
      space({ id: "b", root: "/ok" }),
    ];
    const next = fixBrokenSpaceRoots(spaces, new Set(["/gone"]), "/home");
    expect(next).not.toBe(spaces);
    expect(next[0].root).toBe("/home");
    expect(next[1].root).toBe("/ok");
  });

  it("returns the same array when nothing is broken", () => {
    const spaces = [space({ root: "/ok" })];
    expect(fixBrokenSpaceRoots(spaces, new Set(["/gone"]), "/home")).toBe(
      spaces,
    );
  });
});
