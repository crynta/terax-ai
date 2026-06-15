import { describe, expect, it } from "vitest";
import { placeTab } from "./placeTab";
import type { Tab } from "./useTabs";

function terminalTab(id: number): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "default",
    title: `tab-${id}`,
    paneTree: { kind: "leaf", id: id * 100 },
    activeLeafId: id * 100,
  };
}

const ids = (tabs: Tab[]) => tabs.map((t) => t.id);

describe("placeTab", () => {
  const strip = [terminalTab(1), terminalTab(2), terminalTab(3)];
  const fresh = terminalTab(9);

  it("appends at the end with the 'atLast' behavior", () => {
    expect(ids(placeTab(strip, fresh, 2, "atLast"))).toEqual([1, 2, 3, 9]);
  });

  it("inserts directly after the active tab with 'afterCurrent'", () => {
    expect(ids(placeTab(strip, fresh, 2, "afterCurrent"))).toEqual([
      1, 2, 9, 3,
    ]);
  });

  it("inserts after the active tab when it is last ('afterCurrent')", () => {
    expect(ids(placeTab(strip, fresh, 3, "afterCurrent"))).toEqual([
      1, 2, 3, 9,
    ]);
  });

  it("falls back to appending when the active id is not found", () => {
    expect(ids(placeTab(strip, fresh, 999, "afterCurrent"))).toEqual([
      1, 2, 3, 9,
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [terminalTab(1), terminalTab(2)];
    placeTab(input, fresh, 1, "afterCurrent");
    expect(ids(input)).toEqual([1, 2]);
  });
});
