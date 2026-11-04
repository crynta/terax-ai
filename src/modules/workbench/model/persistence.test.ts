import type { Tab } from "@/modules/tabs/lib/tabs";
import { describe, expect, it } from "vitest";
import { card, cards, split } from "./layout";
import { migrateLegacySpace } from "./legacyMigration";
import {
  hydrateProject,
  serializeProject,
  WORKBENCH_VERSION,
} from "./persistence";
import { EMPTY_WORKBENCH, type Task, type WorkbenchState } from "./workbench";

function alloc(start = 1) {
  let id = start;
  return () => id++;
}

const tabs: Tab[] = [
  { id: 1, kind: "terminal", spaceId: "p", title: "repo", cwd: "/repo" },
  {
    id: 2,
    kind: "terminal",
    spaceId: "p",
    title: "secret",
    private: true,
  },
  {
    id: 3,
    kind: "editor",
    spaceId: "p",
    title: "a.ts",
    path: "/repo/a.ts",
    dirty: false,
    preview: false,
  },
  {
    id: 4,
    kind: "git-history",
    spaceId: "p",
    title: "History",
    repoRoot: "/repo",
  },
];

const tasks: Task[] = [
  {
    id: 10,
    projectId: "p",
    kind: "main",
    createdAt: 5,
    cwd: "/repo",
    layout: split(
      11,
      "row",
      [card(12, [1, 2], 1), card(13, [3, 4], 3), card(14, [4])],
      [0.5, 0.3, 0.2],
    ),
    focusedCardId: 13,
    maximizedCardId: null,
  },
  {
    id: 20,
    projectId: "p",
    kind: "local",
    name: "review",
    createdAt: 6,
    layout: card(21, [2]),
    focusedCardId: 21,
    maximizedCardId: null,
  },
];

const state: WorkbenchState = {
  ...EMPTY_WORKBENCH,
  tabs,
  tasks,
  activeProjectId: "p",
  activeTaskByProject: { p: 10 },
};

describe("serializeProject", () => {
  const saved = serializeProject(state, "p");

  it("drops private terminals and transient views, and tasks left empty", () => {
    expect(saved.version).toBe(WORKBENCH_VERSION);
    expect(saved.tasks).toHaveLength(1);
    expect(saved.tasks[0].layout).toEqual({
      kind: "split",
      dir: "row",
      ratios: [0.625, 0.375],
      children: [
        {
          kind: "card",
          tabs: [{ kind: "terminal", cwd: "/repo" }],
          active: 0,
        },
        {
          kind: "card",
          tabs: [{ kind: "editor", path: "/repo/a.ts" }],
          active: 0,
        },
      ],
    });
    expect(saved.tasks[0].focused).toBe(1);
  });

  it("round-trips through hydration with restored tabs cold", () => {
    const restored = hydrateProject(
      JSON.parse(JSON.stringify(saved)),
      "p",
      alloc(),
    );
    expect(restored.tasks).toHaveLength(1);
    const [task] = restored.tasks;
    expect(task.kind).toBe("main");
    expect(task.cwd).toBe("/repo");
    expect(cards(task.layout)).toHaveLength(2);
    expect(task.focusedCardId).toBe(cards(task.layout)[1].id);
    expect(restored.tabs.every((t) => t.cold)).toBe(true);
    expect(restored.activeTaskId).toBe(task.id);
    expect(
      serializeProject(
        {
          ...EMPTY_WORKBENCH,
          tabs: restored.tabs,
          tasks: restored.tasks,
          activeProjectId: "p",
          activeTaskByProject: { p: task.id },
        },
        "p",
      ),
    ).toEqual({ ...saved, tasks: [{ ...saved.tasks[0] }] });
  });
});

describe("hydrateProject", () => {
  it("ignores unknown versions and corrupt entries", () => {
    expect(
      hydrateProject({ version: 99, tasks: [] }, "p", alloc()).tasks,
    ).toEqual([]);
    const restored = hydrateProject(
      {
        version: WORKBENCH_VERSION,
        activeTask: 0,
        tasks: [
          null,
          {
            kind: "local",
            layout: { kind: "card", tabs: [{ kind: "bogus" }] },
          },
          {
            kind: "local",
            layout: {
              kind: "card",
              tabs: [{ kind: "editor", path: "/x" }],
              active: 0,
            },
          },
        ],
      },
      "p",
      alloc(),
    );
    expect(restored.tasks).toHaveLength(1);
    expect(restored.tasks[0].kind).toBe("main");
  });

  it("counts every unreadable node as a loss, so the blob gets backed up", () => {
    const task = (layout: unknown) => ({ kind: "local", layout });
    const restored = hydrateProject(
      {
        version: WORKBENCH_VERSION,
        activeTask: 0,
        tasks: [
          task({ kind: "grid" }),
          task({ kind: "split", dir: "diagonal", children: [] }),
          task({ kind: "card", tabs: [] }),
          task({ kind: "split", dir: "row", children: [] }),
        ],
      },
      "p",
      alloc(),
    );
    expect(restored.tasks).toEqual([]);
    expect(restored.dropped).toBe(4);
  });
});

describe("migrateLegacySpace", () => {
  const legacy = {
    activeTabIndex: 2,
    tabs: [
      {
        kind: "terminal",
        customTitle: "server",
        tree: {
          kind: "split",
          dir: "col",
          children: [
            { kind: "leaf", cwd: "/repo" },
            { kind: "leaf", cwd: "/repo/web", active: true },
          ],
        },
      },
      { kind: "terminal", tree: { kind: "leaf", cwd: "/tmp" } },
      { kind: "editor", path: "/repo/a.ts" },
      { kind: "markdown", path: "/repo/README.md" },
    ],
  };

  it("keeps every terminal and file, and their arrangement", () => {
    const migrated = migrateLegacySpace(legacy, "p", alloc());
    expect(migrated.tasks.map((t) => t.kind)).toEqual(["main", "local"]);
    expect(migrated.tabs.filter((t) => t.kind === "terminal")).toHaveLength(3);
    const [main, second] = migrated.tasks;
    if (main.layout.kind !== "split") throw new Error("split expected");
    expect(main.layout.dir).toBe("row");
    expect(main.layout.children[0]).toMatchObject({
      kind: "split",
      dir: "col",
    });
    const all = cards(main.layout);
    const docCard = all[all.length - 1];
    expect(docCard?.tabIds).toHaveLength(2);
    expect(main.focusedCardId).toBe(docCard?.id);
    expect(migrated.activeTaskId).toBe(main.id);
    expect(second.layout.kind).toBe("card");
    const named = migrated.tabs.filter(
      (t) => t.kind === "terminal" && t.customTitle === "server",
    );
    expect(named).toHaveLength(2);
  });

  it("focuses the pane that was active inside a migrated terminal tab", () => {
    const migrated = migrateLegacySpace(
      { ...legacy, activeTabIndex: 0 },
      "p",
      alloc(),
    );
    const main = migrated.tasks[0];
    const focused = cards(main.layout).find((c) => c.id === main.focusedCardId);
    const tab = migrated.tabs.find((t) => t.id === focused?.activeTabId);
    expect(tab?.kind === "terminal" && tab.cwd).toBe("/repo/web");
  });

  it("is a pure function of its input", () => {
    expect(migrateLegacySpace(legacy, "p", alloc())).toEqual(
      migrateLegacySpace(legacy, "p", alloc()),
    );
  });
});
