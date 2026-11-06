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
