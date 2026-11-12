import type { Tab } from "@/modules/tabs/lib/tabs";
import { describe, expect, it } from "vitest";
import { card, split } from "../model/layout";
import {
  activateTab,
  EMPTY_WORKBENCH,
  type Task,
  toggleMaximize,
  type WorkbenchState,
} from "../model/workbench";
import { slotOf, visibleTabIds } from "./slot";

const term = (id: number): Tab => ({
  id,
  kind: "terminal",
  spaceId: "p",
  title: "t",
});

function task(id: number, layout: Task["layout"], focusedCardId: number): Task {
  return {
    id,
    projectId: "p",
    kind: id === 10 ? "main" : "local",
    createdAt: 0,
    layout,
    focusedCardId,
    maximizedCardId: null,
  };
}

const state: WorkbenchState = {
  ...EMPTY_WORKBENCH,
  tabs: [term(1), term(2), term(3), term(4)],
  tasks: [
    task(10, split(11, "row", [card(12, [1, 2], 1), card(13, [3])]), 12),
    task(20, card(21, [4]), 21),
  ],
  activeProjectId: "p",
  activeTaskByProject: { p: 10 },
};

describe("slotOf", () => {
  it("shows each card's tab of the active task and focuses one of them", () => {
    expect(slotOf(state, 1)).toMatchObject({ visible: true, focused: true });
    expect(slotOf(state, 3)).toMatchObject({ visible: true, focused: false });
    expect(slotOf(state, 2)).toMatchObject({ visible: false, focused: false });
    expect(slotOf(state, 4)).toMatchObject({ visible: false, focused: true });
  });

  it("claims focus for a pressed slot that did not have it", () => {
    const next = activateTab(state, 3);
    expect(slotOf(next, 3)).toMatchObject({ visible: true, focused: true });
    expect(slotOf(next, 1)).toMatchObject({ visible: true, focused: false });
  });

  it("hides other cards behind a maximized one, which fills the area", () => {
    const next = toggleMaximize(state, 10, 13);
    expect(slotOf(next, 1)?.visible).toBe(false);
    expect(slotOf(next, 3)).toMatchObject({ visible: true, x: 0, w: 1 });
  });

  it("places a tab at its card's frame", () => {
    expect(slotOf(state, 3)).toMatchObject({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(slotOf(state, 99)).toBeNull();
  });
});

it("acknowledges only shown views while keeping every card in the task", () => {
  expect(visibleTabIds(state)).toEqual([1, 3]);
  const maximized = toggleMaximize(state, 10, 13);
  expect(visibleTabIds(maximized)).toEqual([3]);
  expect(maximized.tasks[0].layout).toEqual(state.tasks[0].layout);
});
