import { describe, expect, it } from "vitest";
import { nextActiveInSpace, type Tab } from "./useTabs";

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

describe("nextActiveInSpace", () => {
  it("picks the previous tab within the same space", () => {
    const tabs = [term(1, "a"), term(2, "a"), term(3, "a")];
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
    expect(nextActiveInSpace(tabs, 2)).toBe(1);
  });

  it("falls forward when closing the first tab of a space", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    expect(nextActiveInSpace(tabs, 1)).toBe(2);
  });

  it("never jumps into another space", () => {
    const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];
    expect(nextActiveInSpace(tabs, 2)).toBe(3);
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
  });

  it("returns null for the last tab of its space (refuse to close)", () => {
    const tabs = [term(1, "a"), term(2, "b")];
    expect(nextActiveInSpace(tabs, 1)).toBeNull();
    expect(nextActiveInSpace(tabs, 2)).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(nextActiveInSpace([term(1, "a")], 99)).toBeNull();
  });
});
