import { describe, expect, it } from "vitest";
import { planSpaceRemoval, type Tab, type TerminalTab } from "./useTabs";

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

function counterFrom(start: number) {
  let n = start;
  return () => n++;
}

describe("planSpaceRemoval", () => {
  it("returns null when the space has no tabs", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    expect(planSpaceRemoval(tabs, 1, "b", "a", undefined, counterFrom(100))).toBeNull();
  });

  it("drops every tab of the deleted space and disposes their leaves", () => {
    const tabs = [term(1, "a"), term(2, "a"), term(3, "b")];
    const plan = planSpaceRemoval(tabs, 1, "a", "b", undefined, counterFrom(100));
    expect(plan).not.toBeNull();
    expect(plan?.tabs.map((t) => t.id)).toEqual([3]);
    expect(plan?.disposeLeafIds).toEqual([10, 20]);
  });

  it("repoints active to the fallback space's last tab when the active tab is removed", () => {
    const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];
    const plan = planSpaceRemoval(tabs, 1, "a", "b", undefined, counterFrom(100));
    expect(plan?.activeId).toBe(3);
  });

  it("keeps the active tab when it survives the removal", () => {
    const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];
    const plan = planSpaceRemoval(tabs, 3, "a", "b", undefined, counterFrom(100));
    expect(plan?.activeId).toBe(3);
  });

  it("spawns a cold tab when the fallback space would be left empty", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    const plan = planSpaceRemoval(tabs, 1, "a", "b", "/work", counterFrom(100));
    expect(plan?.tabs).toHaveLength(1);
    const spawned = plan?.tabs[0] as TerminalTab;
    expect(spawned.id).toBe(100);
    expect(spawned.spaceId).toBe("b");
    expect(spawned.cold).toBe(true);
    expect(spawned.cwd).toBe("/work");
    expect(spawned.title).toBe("work");
    expect(plan?.activeId).toBe(100);
    expect(plan?.disposeLeafIds).toEqual([10, 20]);
  });
});
