import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "./useTabs";

const scheduler = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  pending: [] as (() => void)[],
  dispose: vi.fn(),
}));

vi.mock("@/modules/terminal/lib/terminalSessionApi", () => ({
  disposeSession: scheduler.dispose,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = scheduler.cursor++;
    if (!(index in scheduler.slots))
      scheduler.slots[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      scheduler.slots[index],
      (action: T | ((value: T) => T)) => {
        scheduler.pending.push(() => {
          scheduler.slots[index] =
            typeof action === "function"
              ? (action as (value: T) => T)(scheduler.slots[index] as T)
              : action;
        });
      },
    ];
  },
  useRef: <T>(initial: T) => {
    const index = scheduler.cursor++;
    if (!(index in scheduler.slots))
      scheduler.slots[index] = { current: initial };
    return scheduler.slots[index];
  },
  useCallback: <T>(callback: T) => callback,
  useEffect: () => {},
  useLayoutEffect: () => {},
}));

function render() {
  for (const commit of scheduler.pending.splice(0)) commit();
  scheduler.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: hooks use the deferred scheduler above, not React's dispatcher.
  return useTabs();
}

beforeEach(() => {
  scheduler.cursor = 0;
  scheduler.slots = [];
  scheduler.pending = [];
  scheduler.dispose.mockClear();
});

describe("tab actions before deferred state updates commit", () => {
  it("keeps a pending new tab when closing its predecessor", () => {
    const tabs = render();
    const created = tabs.newTab();
    tabs.closeTab(1);
    expect(scheduler.dispose).toHaveBeenCalledExactlyOnceWith(2);
    const next = render();
    expect(next.tabs.map((tab) => tab.id)).toEqual([created]);
    expect(next.activeId).toBe(created);
  });

  it("keeps unplanned additions during a multi-tab close", () => {
    const tabs = render();
    const closing = tabs.newTab();
    const surviving = tabs.newTab();
    tabs.closeTabs(1, { closeIds: [closing], nextActiveId: 1 });
    expect(render().tabs.map((tab) => tab.id)).toEqual([1, surviving]);
    expect(scheduler.dispose).toHaveBeenCalledTimes(1);
  });

  it("returns a split leaf immediately and disposes it once on close", () => {
    const tabs = render();
    const leaf = tabs.splitActivePane(1, "row");
    expect(leaf).not.toBeNull();
    tabs.closeActivePane(1);
    expect(scheduler.dispose).toHaveBeenCalledExactlyOnceWith(leaf);
    const tab = render().tabs[0];
    expect(tab.kind === "terminal" && tab.paneTree).toEqual({
      kind: "leaf",
      id: 2,
    });
  });

  it("cleans pending sessions when resetting the workspace", () => {
    const tabs = render();
    tabs.newTab();
    tabs.resetWorkspace("/next");
    expect(scheduler.dispose.mock.calls.map(([id]) => id)).toEqual([2, 4]);
    expect(render().tabs).toHaveLength(1);
  });

  it("disposes a removed split leaf only once across repeated close requests", () => {
    const tabs = render();
    const leaf = tabs.splitActivePane(1, "row");
    if (leaf === null) throw new Error("Expected split leaf");
    tabs.closePaneByLeaf(leaf);
    tabs.closePaneByLeaf(leaf);
    expect(scheduler.dispose).toHaveBeenCalledExactlyOnceWith(leaf);
    expect(render().tabs).toHaveLength(1);
  });

  it("removes a space together with its pending terminal additions", () => {
    const tabs = render();
    const space = tabs.tabs[0].spaceId;
    tabs.newTab();
    tabs.removeTabsForSpace(space, "replacement", "/next");
    expect(scheduler.dispose.mock.calls.map(([id]) => id)).toEqual([2, 4]);
    const next = render();
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0]).toMatchObject({
      spaceId: "replacement",
      cwd: "/next",
    });
  });
});
