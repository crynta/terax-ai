import { describe, expect, it } from "vitest";
import { deserializeSession } from "./sessionDeserialize";
import type { SessionV1 } from "./sessionSchema";

describe("deserializeSession", () => {
  it("returns null for null/undefined input", () => {
    expect(deserializeSession(null, 1)).toBe(null);
    expect(deserializeSession(undefined, 1)).toBe(null);
  });

  it("returns null when version is not 1", () => {
    const bad = { version: 2, updatedAt: 0, activeTabId: null, tabs: [] };
    expect(deserializeSession(bad as unknown, 1)).toBe(null);
  });

  it("returns null when the shape is malformed", () => {
    expect(deserializeSession({ version: 1 } as unknown, 1)).toBe(null);
    expect(
      deserializeSession(
        { version: 1, updatedAt: 0, activeTabId: null, tabs: "nope" } as unknown,
        1,
      ),
    ).toBe(null);
  });

  it("returns empty result when tabs is empty", () => {
    const empty: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: null,
      tabs: [],
    };
    const r = deserializeSession(empty, 100);
    expect(r).not.toBe(null);
    expect(r!.tabs).toEqual([]);
    expect(r!.activeId).toBe(0);
    expect(r!.nextId).toBe(100);
  });

  it("remaps tab and leaf ids starting at the provided seed", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 5,
      tabs: [
        {
          kind: "terminal",
          id: 5,
          title: "shell",
          cwd: "/x",
          paneTree: {
            kind: "split",
            id: 6,
            dir: "row",
            children: [
              { kind: "leaf", id: 7, cwd: "/x" },
              { kind: "leaf", id: 8, cwd: "/y" },
            ],
          },
          activeLeafId: 8,
        },
      ],
    };
    const r = deserializeSession(saved, 100)!;
    expect(r.tabs).toHaveLength(1);
    const t = r.tabs[0];
    expect(t.kind).toBe("terminal");
    expect(t.id).toBe(100);
    expect(r.activeId).toBe(100);
    if (t.kind !== "terminal") throw new Error();
    expect(t.paneTree.kind).toBe("split");
    if (t.paneTree.kind !== "split") throw new Error();
    expect(t.paneTree.id).toBe(101);
    expect(t.paneTree.children[0].id).toBe(102);
    expect(t.paneTree.children[1].id).toBe(103);
    expect(t.activeLeafId).toBe(103);
    expect(r.nextId).toBe(104);
  });

  it("falls back activeId to the first tab when the saved activeTabId is not in the array", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 999,
      tabs: [
        {
          kind: "editor",
          id: 1,
          path: "/a",
        },
      ],
    };
    const r = deserializeSession(saved, 50)!;
    expect(r.tabs).toHaveLength(1);
    expect(r.activeId).toBe(50);
  });

  it("restores editor and markdown tabs with default fields", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 1,
      tabs: [
        { kind: "editor", id: 1, path: "/a" },
        { kind: "markdown", id: 2, path: "/b" },
      ],
    };
    const r = deserializeSession(saved, 10)!;
    expect(r.tabs[0]).toEqual({
      id: 10,
      kind: "editor",
      title: "a",
      path: "/a",
      dirty: false,
      preview: false,
    });
    expect(r.tabs[1]).toEqual({ id: 11, kind: "markdown", title: "b", path: "/b" });
  });

  it("carries split sizes through when shape matches; drops them when mismatched", () => {
    const good: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 1,
      tabs: [
        {
          kind: "terminal",
          id: 1,
          title: "shell",
          cwd: null,
          paneTree: {
            kind: "split",
            id: 2,
            dir: "row",
            children: [
              { kind: "leaf", id: 3, cwd: null },
              { kind: "leaf", id: 4, cwd: null },
            ],
            sizes: [30, 70],
          },
          activeLeafId: 3,
        },
      ],
    };
    const r = deserializeSession(good, 100)!;
    const t = r.tabs[0];
    if (t.kind !== "terminal" || t.paneTree.kind !== "split") throw new Error();
    expect(t.paneTree.sizes).toEqual([30, 70]);

    // Mismatched sizes (3 entries but only 2 children) are silently dropped.
    const bad = JSON.parse(JSON.stringify(good)) as SessionV1;
    (bad.tabs[0] as { paneTree: { sizes: number[] } }).paneTree.sizes = [
      10, 20, 70,
    ];
    const r2 = deserializeSession(bad, 100)!;
    const t2 = r2.tabs[0];
    if (t2.kind !== "terminal" || t2.paneTree.kind !== "split") throw new Error();
    expect(t2.paneTree.sizes).toBeUndefined();
  });

  it("preserves private flag on terminal tabs", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 1,
      tabs: [
        {
          kind: "terminal",
          id: 1,
          title: "private",
          cwd: null,
          paneTree: { kind: "leaf", id: 2, cwd: null },
          activeLeafId: 2,
          private: true,
        },
      ],
    };
    const r = deserializeSession(saved, 100)!;
    const t = r.tabs[0];
    if (t.kind !== "terminal") throw new Error();
    expect(t.private).toBe(true);
  });
});
