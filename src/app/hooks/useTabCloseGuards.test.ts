import type { Tab } from "@/modules/tabs/lib/tabs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = initial;
      return [
        harness.slots[index],
        (value: unknown) => {
          harness.slots[index] = value;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots))
        harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
  };
});
const data = vi.hoisted(() => ({
  tabs: [] as Tab[],
  busy: vi.fn(async (_id: number) => false),
  remove: vi.fn(() => "q"),
  removeProject: vi.fn(),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ confirmCloseRunningTerminal: true }),
  },
}));
vi.mock("@/modules/terminal", () => ({ leafHasForegroundProcess: data.busy }));
vi.mock("@/modules/workbench", () => ({
  snapshot: () => ({ tabs: data.tabs }),
  // Individual close protects main's last view. Project deletion must check it anyway.
  planClose: () => ({ close: [] }),
  closeTabsNow: vi.fn(),
  closeTabsReplacingLast: vi.fn(),
}));
vi.mock("@/modules/workbench/actions", () => ({
  removeProject: data.removeProject,
}));
vi.mock("@/modules/spaces/lib/useSpaces", () => ({
  useSpaces: {
    getState: () => ({
      spaces: [{ id: "p" }, { id: "q", root: "/q" }],
      remove: data.remove,
    }),
  },
}));
import { useTabCloseGuards } from "./useTabCloseGuards";

function render() {
  let result!: ReturnType<typeof useTabCloseGuards>;
  function Probe() {
    harness.cursor = 0;
    result = useTabCloseGuards();
    return null;
  }
  renderToString(createElement(Probe));
  return result;
}
const terminal: Tab = { id: 1, kind: "terminal", spaceId: "p", title: "shell" };
const editor: Tab = {
  id: 2,
  kind: "editor",
  spaceId: "p",
  title: "file",
  path: "/file",
  dirty: true,
  preview: false,
};
beforeEach(() => {
  harness.slots = [];
  data.tabs = [terminal, editor];
  vi.clearAllMocks();
  data.busy.mockResolvedValue(false);
});

it("checks the permanent main task's views before deleting a project, and can cancel", async () => {
  data.busy.mockResolvedValue(true);
  await render().handleDeleteProject("p");
  const pending = render();
  expect(pending.pendingCloseMany).toMatchObject({
    kind: "project",
    dirtyIds: [2],
    busyLeafIds: [1],
  });
  expect(data.remove).not.toHaveBeenCalled();
  pending.cancelCloseMany();
  expect(render().pendingCloseMany).toBeNull();
  expect(data.removeProject).not.toHaveBeenCalled();
});

it("rechecks new dirty views before accepting a project deletion", async () => {
  await render().handleDeleteProject("p");
  data.tabs.push({ ...editor, id: 3 });
  await render().confirmCloseMany();
  expect(data.remove).not.toHaveBeenCalled();
  expect(render().pendingCloseMany?.dirtyIds).toEqual([2, 3]);
  await render().confirmCloseMany();
  expect(data.remove).toHaveBeenCalledExactlyOnceWith("p");
  expect(data.removeProject).toHaveBeenCalledExactlyOnceWith("p", "q", "/q");
});

it("includes terminals added while foreground-process checks are pending", async () => {
  data.tabs = [terminal];
  data.busy.mockImplementationOnce(async () => {
    data.tabs.push({ ...terminal, id: 3 });
    return false;
  });
  data.busy.mockImplementation(async (id) => id === 3);
  await render().handleDeleteProject("p");
  expect(render().pendingCloseMany?.busyLeafIds).toEqual([3]);
  expect(data.remove).not.toHaveBeenCalled();
});
