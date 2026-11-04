import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { basename, countNeedingInput, selectSessionRows } from "./sessionRows";
import type { AgentNotification, AgentSession } from "./types";

const SESSION = "0b5f4c2e-9a1d-4e3b-8c7f-1234567890ab";

function session(
  leafId: number,
  tabId: number,
  patch: Partial<AgentSession> = {},
): AgentSession {
  return {
    leafId,
    tabId,
    agent: "claude",
    status: "working",
    startedAt: 1000,
    lastActivityAt: 1000,
    attentionSince: null,
    claudeSessionId: null,
    ...patch,
  };
}

const tabs = [
  {
    id: 1,
    kind: "terminal",
    title: "zsh",
    cwd: "/r/app",
    paneTree: { kind: "leaf", id: 10, cwd: "/r/app" },
    activeLeafId: 10,
  },
  {
    id: 2,
    kind: "terminal",
    title: "agents",
    customTitle: "Review squad",
    paneTree: {
      kind: "split",
      dir: "row",
      children: [
        { kind: "leaf", id: 20, cwd: "/r/api/" },
        { kind: "leaf", id: 21, cwd: "/r/web" },
      ],
      sizes: [50, 50],
    },
    activeLeafId: 20,
  },
] as unknown as Tab[];

const ptyIdForLeaf = (leafId: number) => leafId + 100;

describe("selectSessionRows", () => {
  it("orders needs-you first, then working, then finished, newest first", () => {
    const rows = selectSessionRows({
      sessions: {
        10: session(10, 1, { lastActivityAt: 5000 }),
        20: session(20, 2, { status: "waiting", attentionSince: 3000 }),
        21: session(21, 2, { status: "waiting", attentionSince: 4000 }),
      },
      phases: { 110: "working", 120: "attention", 121: "finished" },
      sessionIds: {},
      notifications: [],
      tabs,
      ptyIdForLeaf,
    });
    expect(rows.map((r) => [r.leafId, r.phase])).toEqual([
      [20, "attention"],
      [10, "working"],
      [21, "finished"],
    ]);
  });

  it("titles rows by custom title, pane and cwd, and links the transcript", () => {
    const notifications = [
      { leafId: 20, kind: "attention", at: 10 },
      { leafId: 20, kind: "finished", at: 20 },
    ] as AgentNotification[];
    const rows = selectSessionRows({
      sessions: {
        10: session(10, 1),
        20: session(20, 2, { claudeSessionId: SESSION }),
        21: session(21, 2),
      },
      phases: {},
      sessionIds: { 110: SESSION },
      notifications,
      tabs,
      ptyIdForLeaf,
    });
    const byLeaf = Object.fromEntries(rows.map((r) => [r.leafId, r]));
    expect(byLeaf[10]).toMatchObject({
      title: "zsh",
      paneLabel: null,
      cwd: "/r/app",
    });
    expect(byLeaf[10].claudeSessionId).toBe(SESSION);
    expect(byLeaf[20]).toMatchObject({
      title: "Review squad",
      paneLabel: "Pane 1",
      cwd: "/r/api/",
      claudeSessionId: SESSION,
      lastNotification: { kind: "finished", at: 20 },
    });
    expect(byLeaf[21].paneLabel).toBe("Pane 2");
  });

  it("falls back to the session status without a live phase and drops closed tabs", () => {
    const rows = selectSessionRows({
      sessions: {
        10: session(10, 1, { status: "waiting" }),
        30: session(30, 9),
      },
      phases: {},
      sessionIds: {},
      notifications: [],
      tabs,
      ptyIdForLeaf: () => null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("attention");
    expect(countNeedingInput(rows)).toBe(1);
  });
});

describe("basename", () => {
  it("takes the last path segment of posix and windows paths", () => {
    expect(basename("/r/api/")).toBe("api");
    expect(basename("C:\\work\\repo")).toBe("repo");
    expect(basename("/")).toBe("/");
  });
});
