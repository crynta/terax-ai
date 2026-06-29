import { describe, expect, it } from "vitest";
import { pickTabBySpaceIndex, type Tab } from "./useTabs";

function term(id: number, spaceId: string): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as Tab;
}

describe("pickTabBySpaceIndex", () => {
  const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];

  it("Cmd+1 in space B returns B's first tab, not A's", () => {
    expect(pickTabBySpaceIndex(tabs, 0, "b")?.id).toBe(2);
  });

  it("Cmd+2 in space B returns B's second tab", () => {
    expect(pickTabBySpaceIndex(tabs, 1, "b")?.id).toBe(3);
  });

  it("Cmd+3 in space B returns undefined (does nothing)", () => {
    expect(pickTabBySpaceIndex(tabs, 2, "b")).toBeUndefined();
  });

  it("Cmd+1 in space A returns A's only tab", () => {
    expect(pickTabBySpaceIndex(tabs, 0, "a")?.id).toBe(1);
  });

  it("returns undefined for an empty space", () => {
    expect(pickTabBySpaceIndex(tabs, 0, "c")).toBeUndefined();
  });
});
