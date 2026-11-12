import type { EditorTab, Tab, TerminalTab } from "@/modules/tabs/lib/tabs";
import { describe, expect, it } from "vitest";
import { card, cardIds, cards, findCard, split } from "./layout";
import {
  activateTab,
  activeTabId,
  addSingleTabTask,
  addTab,
  closeTabs,
  EMPTY_WORKBENCH,
  locateTab,
  moveTabToCard,
  moveTabToSplit,
  moveTaskToProject,
  openDocument,
  placeTask,
  planClose,
  projectTasks,
  reorderTask,
  splitOffTab,
  type Task,
  toggleMaximize,
  visibleTabIds,
  type WorkbenchState,
  warmVisible,
} from "./workbench";

function alloc(start = 1000) {
  let id = start;
  return () => id++;
}

const term = (id: number, spaceId = "p"): TerminalTab => ({
  id,
  kind: "terminal",
  spaceId,
  title: "shell",
});

const editor = (id: number, path: string, preview = false): EditorTab => ({
  id,
  kind: "editor",
  spaceId: "p",
  title: path,
  path,
  dirty: false,
  preview,
});

function task(
  id: number,
  layout: Task["layout"],
  over: Partial<Task> = {},
): Task {
  return {
    id,
    projectId: "p",
    kind: "local",
    createdAt: 0,
    layout,
    focusedCardId: cards(layout)[0].id,
    maximizedCardId: null,
    ...over,
  };
}

function state(tabs: Tab[], tasks: Task[]): WorkbenchState {
  return {
    ...EMPTY_WORKBENCH,
    tabs,
    tasks,
    activeProjectId: "p",
    activeTaskByProject: { p: tasks[0].id },
  };
}

describe("focus", () => {
  const s = state(
    [term(1), term(2), term(3)],
    [
      task(10, split(11, "row", [card(12, [1, 2]), card(13, [3])]), {
        kind: "main",
      }),
    ],
  );

  it("activating a tab focuses its card and shows it in the card", () => {
    const next = activateTab(s, 2);
    expect(activeTabId(next)).toBe(2);
    expect(visibleTabIds(next)).toEqual(new Set([2, 3]));
  });

  it("maximizing shows only the maximized card", () => {
    const next = toggleMaximize(s, 10, 13);
    expect(visibleTabIds(next)).toEqual(new Set([3]));
    expect(visibleTabIds(toggleMaximize(next, 10, 13))).toEqual(
      new Set([1, 3]),
    );
  });

  it("warms only on-screen restored tabs", () => {
    const cold = state(
      [
        { ...term(1), cold: true },
        { ...term(2), cold: true },
      ],
      [task(10, card(12, [1, 2]))],
    );
    const warmed = warmVisible(cold);
    expect(warmed.tabs.map((t) => !!t.cold)).toEqual([false, true]);
  });
});

describe("closing", () => {
  it("keeps the last tab of a project's main task", () => {
    const s = state([term(1)], [task(10, card(12, [1]), { kind: "main" })]);
    expect(planClose(s, [1]).close).toEqual([]);
    expect(closeTabs(s, [1]).state).toBe(s);
  });

  it("removes an emptied card and focuses its neighbour", () => {
    const s = state(
      [term(1), term(2)],
      [
        task(10, split(11, "row", [card(12, [1]), card(13, [2])]), {
          kind: "main",
          focusedCardId: 13,
        }),
      ],
    );
    const { state: next, closed } = closeTabs(s, [2]);
    expect(closed.map((t) => t.id)).toEqual([2]);
    expect(next.tasks[0].layout).toEqual(card(12, [1]));
    expect(next.tasks[0].focusedCardId).toBe(12);
  });

  it("activates the left neighbour inside a card", () => {
    const s = state(
      [term(1), term(2), term(3)],
      [task(10, card(12, [1, 2, 3], 2), { kind: "main" })],
    );
    const next = closeTabs(s, [2]).state;
    expect(findCard(next.tasks[0].layout, 12)?.activeTabId).toBe(1);
  });

  it("closes an emptied task and falls back to its strip neighbour", () => {
    const s = {
      ...state(
        [term(1), term(2)],
        [task(10, card(12, [1]), { kind: "main" }), task(20, card(22, [2]))],
      ),
      activeTaskByProject: { p: 20 },
    };
    const next = closeTabs(s, [2]).state;
    expect(next.tasks.map((t) => t.id)).toEqual([10]);
    expect(next.activeTaskByProject.p).toBe(10);
  });
});

describe("opening documents", () => {
  it("opens beside terminals in a new card, then stacks there", () => {
    let s = state([term(1)], [task(10, card(12, [1]))]);
    const a = alloc();
    s = openDocument(s, 10, editor(2, "/a.ts"), (t) => t.id === -1, a).state;
    expect(cards(s.tasks[0].layout).map((c) => c.tabIds)).toEqual([[1], [2]]);
    s = activateTab(s, 1);
    s = openDocument(s, 10, editor(3, "/b.ts"), (t) => t.id === -1, a).state;
    expect(cards(s.tasks[0].layout).map((c) => c.tabIds)).toEqual([
      [1],
      [2, 3],
    ]);
    expect(activeTabId(s)).toBe(3);
  });

  it("replaces the card's preview slot with the next preview", () => {
    let s = state([editor(1, "/a.ts", true)], [task(10, card(12, [1]))]);
    s = openDocument(
      s,
      10,
      editor(2, "/b.ts", true),
      (t) => t.kind === "editor" && t.path === "/b.ts",
      alloc(),
    ).state;
    expect(s.tabs.map((t) => t.id)).toEqual([2]);
    expect(findCard(s.tasks[0].layout, 12)?.tabIds).toEqual([2]);
  });

  it("reuses an open tab for the same file", () => {
    const s = state(
      [term(1), editor(2, "/a.ts")],
      [task(10, card(12, [1, 2], 1))],
    );
    const result = openDocument(
      s,
      10,
      editor(3, "/a.ts"),
      (t) => t.kind === "editor" && t.path === "/a.ts",
      alloc(),
    );
    expect(result.tabId).toBe(2);
    expect(result.state.tabs).toHaveLength(2);
    expect(activeTabId(result.state)).toBe(2);
  });
});

describe("moving tabs between cards", () => {
  const base = () => state([term(1), term(2)], [task(10, card(12, [1, 2], 2))]);

  it("splits a stacked tab into its own card", () => {
    const s = splitOffTab(base(), 2, "row", alloc());
    expect(cards(s.tasks[0].layout).map((c) => c.tabIds)).toEqual([[1], [2]]);
    expect(activeTabId(s)).toBe(2);
  });

  it("refuses to split the only tab of a card", () => {
    const s = state([term(1)], [task(10, card(12, [1]))]);
    expect(splitOffTab(s, 1, "row", alloc())).toBe(s);
  });

  it("moves a tab into another card, removing an emptied source", () => {
    let s = addTab(
      base(),
      10,
      term(3),
      { kind: "split", cardId: 12, dir: "row" },
      alloc(),
    );
    const target = cardIds(s.tasks[0].layout)[0];
    s = moveTabToCard(s, 3, target, 0);
    expect(cards(s.tasks[0].layout).map((c) => c.tabIds)).toEqual([[3, 1, 2]]);
    expect(locateTab(s, 3)?.cardId).toBe(target);
  });
});

describe("tasks", () => {
  it("adds a task without stealing focus when asked", () => {
    const s = state([term(1)], [task(10, card(12, [1]), { kind: "main" })]);
    const { state: next } = addSingleTabTask(
      s,
      { projectId: "p", kind: "local" },
      term(2),
      alloc(),
      { activate: false },
    );
    expect(projectTasks(next, "p")).toHaveLength(2);
    expect(activeTabId(next)).toBe(1);
  });

  it("reorders within the project strip", () => {
    const s = state(
      [term(1), term(2), term(3)],
      [
        task(10, card(11, [1])),
        task(20, card(21, [2])),
        task(30, card(31, [3])),
      ],
    );
    expect(reorderTask(s, 30, 0).tasks.map((t) => t.id)).toEqual([30, 10, 20]);
  });

  it("moves a task and its tabs to another project; main stays", () => {
    const s = state(
      [term(1), term(2)],
      [task(10, card(11, [1]), { kind: "main" }), task(20, card(21, [2]))],
    );
    const next = moveTaskToProject(s, 20, "q");
    expect(next.tasks.find((t) => t.id === 20)?.projectId).toBe("q");
    expect(next.tabs.find((t) => t.id === 2)?.spaceId).toBe("q");
    expect(next.activeTaskByProject.q).toBe(20);
    expect(moveTaskToProject(s, 10, "q")).toBe(s);
  });

  it("places a task beside another, adopting its project", () => {
    const s = {
      ...state(
        [term(1), term(2), term(3, "q")],
        [
          task(10, card(11, [1]), { kind: "main" }),
          task(20, card(21, [2])),
          task(30, card(31, [3]), { projectId: "q", kind: "main" }),
        ],
      ),
    };
    const next = placeTask(s, 20, 30, "top");
    expect(projectTasks(next, "q").map((t) => t.id)).toEqual([20, 30]);
  });
});

describe("dropping a tab on a card edge", () => {
  const two = () =>
    state(
      [term(1), term(2), term(3)],
      [task(10, split(11, "row", [card(12, [1, 2], 2), card(13, [3])]))],
    );

  it("gives the tab its own card on that side of the target", () => {
    const s = moveTabToSplit(two(), 2, 13, "col", "before", alloc());
    if (s.tasks[0].layout.kind !== "split") throw new Error("split expected");
    expect(cards(s.tasks[0].layout).map((c) => c.tabIds)).toEqual([
      [1],
      [2],
      [3],
    ]);
    expect(s.tasks[0].layout.children[1]).toMatchObject({
      kind: "split",
      dir: "col",
    });
    expect(activeTabId(s)).toBe(2);
  });

  it("moves a card's only tab, removing the emptied card", () => {
    const s = moveTabToSplit(two(), 3, 12, "row", "before", alloc());
    expect(cards(s.tasks[0].layout).map((c) => c.tabIds)).toEqual([
      [3],
      [1, 2],
    ]);
  });

  it("cannot split a card's only tab from itself", () => {
    const s = two();
    expect(moveTabToSplit(s, 3, 13, "row", "after", alloc())).toBe(s);
  });
});

it("keeps focus on the neighboring task when the same close also rebuilds it", () => {
  const s = state(
    [term(1), term(2), term(3), term(4)],
    [
      task(10, card(11, [1]), { kind: "main" }),
      task(20, card(21, [2, 3])),
      task(30, card(31, [4])),
    ],
  );
  const next = closeTabs(
    { ...s, activeTaskByProject: { p: 30 } },
    [3, 4],
  ).state;
  expect(next.activeTaskByProject.p).toBe(20);
  expect(activeTabId(next)).toBe(2);
});
