import type { Tab } from "@/modules/tabs/lib/tabs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disposeSession = vi.hoisted(() => vi.fn());
vi.mock("@/modules/terminal/lib/terminalSessionApi", () => ({
  disposeSession,
}));

const { card } = await import("./model/layout");
const { EMPTY_WORKBENCH, closeTabs } = await import("./model/workbench");
const { commit, hydrateWorkbench, markBooted, useWorkbench } = await import(
  "./store"
);
const { setViewHandle, viewHandle } = await import("./viewHandles");

const tabs: Tab[] = [
  { id: 1, kind: "terminal", spaceId: "p", title: "a", cold: true },
  { id: 2, kind: "terminal", spaceId: "p", title: "b", cold: true },
  {
    id: 3,
    kind: "editor",
    spaceId: "p",
    title: "x",
    path: "/x",
    dirty: false,
    preview: false,
    cold: true,
  },
];

beforeEach(() => {
  disposeSession.mockClear();
  useWorkbench.setState({ ...EMPTY_WORKBENCH, booted: false });
  hydrateWorkbench({
    tabs,
    tasks: [
      {
        id: 10,
        projectId: "p",
        kind: "main",
        createdAt: 0,
        layout: card(11, [1, 2, 3], 1),
        focusedCardId: 11,
        maximizedCardId: null,
      },
    ],
    activeProjectId: "p",
    activeTaskByProject: { p: 10 },
  });
});

describe("workbench commit", () => {
  it("keeps restored tabs cold until boot, then warms only what is shown", () => {
    expect(useWorkbench.getState().tabs.every((t) => t.cold)).toBe(true);
    markBooted();
    expect(useWorkbench.getState().tabs.map((t) => !!t.cold)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("disposes the session and forgets the handles of a closed terminal", () => {
    setViewHandle(2, "terminal", { focus() {} } as never);
    commit((s) => closeTabs(s, [2, 3]).state);
    expect(disposeSession).toHaveBeenCalledExactlyOnceWith(2);
    expect(viewHandle(2, "terminal")).toBeUndefined();
  });

  it("returns the same state and disposes nothing for a no-op update", () => {
    const before = useWorkbench.getState();
    expect(commit((s) => s)).toBe(before);
    expect(disposeSession).not.toHaveBeenCalled();
  });

  it("allocates ids above everything restored", async () => {
    const { allocId } = await import("./store");
    expect(allocId()).toBeGreaterThan(11);
  });
});

it("reuses an editor opened with Windows separators", async () => {
  const { openFile } = await import("./actions");
  const first = openFile("C:\\repo\\file.ts");
  expect(openFile("C:/repo/file.ts")).toBe(first);
  expect(
    useWorkbench
      .getState()
      .tabs.filter((t) => t.kind === "editor" && t.id === first),
  ).toHaveLength(1);
});

it("restarts a terminal in place with sibling views and preserves its options", async () => {
  const { restartTerminal } = await import("./actions");
  const { updateTab } = await import("./model/workbench");
  commit((s) =>
    updateTab(s, 1, (t) => ({
      ...t,
      cwd: "/repo",
      customTitle: "Build",
      blocks: true,
      private: true,
    })),
  );
  const before = useWorkbench.getState();
  restartTerminal(1);
  const after = useWorkbench.getState();
  const next = after.tabs[0];
  expect(next.id).not.toBe(1);
  expect(next).toMatchObject({
    kind: "terminal",
    spaceId: "p",
    title: "a",
    cwd: "/repo",
    customTitle: "Build",
    blocks: true,
    private: true,
  });
  expect(after.tasks[0].layout).toEqual(card(11, [next.id, 2, 3], next.id));
  expect(after.tasks[0].focusedCardId).toBe(before.tasks[0].focusedCardId);
  expect(after.tabs.slice(1)).toEqual(before.tabs.slice(1));
  expect(disposeSession).toHaveBeenCalledExactlyOnceWith(1);
});

it("restarts a background local-task terminal without changing active focus", async () => {
  const { newTask, restartTerminal } = await import("./actions");
  const { tabId, taskId } = newTask({ activate: false });
  const before = useWorkbench.getState();
  restartTerminal(tabId);
  const after = useWorkbench.getState();
  expect(after.activeTaskByProject).toEqual(before.activeTaskByProject);
  expect(after.tasks.find((t) => t.id === taskId)?.layout).not.toEqual(
    before.tasks.find((t) => t.id === taskId)?.layout,
  );
  expect(after.tabs).toHaveLength(before.tabs.length);
  expect(after.tabs.some((t) => t.id === tabId)).toBe(false);
  expect(disposeSession).toHaveBeenCalledExactlyOnceWith(tabId);
});

it.each(["unchanged", "project", "sidebar"])(
  "checks focus ownership when a queued preview mounts: %s",
  async (target) => {
    const { openPreview, selectProject } = await import("./actions");
    const { forgetViewHandles } = await import("./viewHandles");
    vi.stubGlobal("document", {
      activeElement: { tagName: "BODY", closest: () => null },
    });
    const id = openPreview("")!;
    try {
      if (target === "project") selectProject("other");
      if (target === "sidebar")
        vi.stubGlobal("document", {
          activeElement: { tagName: "INPUT", closest: () => null },
        });
      const focusAddressBar = vi.fn();
      setViewHandle(id, "preview", { focusAddressBar } as never);
      expect(focusAddressBar).toHaveBeenCalledTimes(
        target === "unchanged" ? 1 : 0,
      );
    } finally {
      forgetViewHandles(id);
      vi.unstubAllGlobals();
    }
  },
);
