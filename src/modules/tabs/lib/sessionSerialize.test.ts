import { describe, expect, it } from "vitest";
import type { Tab } from "./useTabs";
import { serializeSession } from "./sessionSerialize";
import { SESSION_SCHEMA_VERSION } from "./sessionSchema";

const NOW = 1748275200000; // stable for tests

function withFakeNow<T>(fn: () => T): T {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

describe("serializeSession", () => {
  it("returns the schema version and timestamp", () => {
    const out = withFakeNow(() => serializeSession([], 0));
    expect(out.version).toBe(SESSION_SCHEMA_VERSION);
    expect(out.updatedAt).toBe(NOW);
    expect(out.activeTabId).toBe(null);
    expect(out.tabs).toEqual([]);
  });

  it("serializes a terminal tab with a single leaf", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: "/home/me",
        paneTree: { kind: "leaf", id: 2, cwd: "/home/me" },
        activeLeafId: 2,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs).toEqual([
      {
        kind: "terminal",
        id: 1,
        title: "shell",
        cwd: "/home/me",
        paneTree: { kind: "leaf", id: 2, cwd: "/home/me" },
        activeLeafId: 2,
      },
    ]);
    expect(out.activeTabId).toBe(1);
  });

  it("serializes a terminal tab with a split (n-ary children)", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: undefined,
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3, cwd: "/a" },
            { kind: "leaf", id: 4, cwd: "/b" },
            { kind: "leaf", id: 5, cwd: undefined },
          ],
        },
        activeLeafId: 4,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs[0]).toMatchObject({
      kind: "terminal",
      paneTree: {
        kind: "split",
        id: 2,
        dir: "row",
        children: [
          { kind: "leaf", id: 3, cwd: "/a" },
          { kind: "leaf", id: 4, cwd: "/b" },
          { kind: "leaf", id: 5, cwd: null },
        ],
      },
      activeLeafId: 4,
    });
  });

  it("includes split sizes when set, omits when absent", () => {
    const withSizes: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3 },
            { kind: "leaf", id: 4 },
          ],
          sizes: [30, 70],
        },
        activeLeafId: 3,
      },
    ];
    const out = withFakeNow(() => serializeSession(withSizes, 1));
    expect(out.tabs[0]).toMatchObject({
      paneTree: { kind: "split", sizes: [30, 70] },
    });

    const withoutSizes: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3 },
            { kind: "leaf", id: 4 },
          ],
        },
        activeLeafId: 3,
      },
    ];
    const out2 = withFakeNow(() => serializeSession(withoutSizes, 1));
    expect((out2.tabs[0] as { paneTree: { sizes?: number[] } }).paneTree.sizes).toBeUndefined();
  });

  it("serializes editor and markdown tabs", () => {
    const tabs: Tab[] = [
      {
        id: 10,
        kind: "editor",
        title: "App.tsx",
        path: "/p/App.tsx",
        dirty: false,
        preview: false,
      },
      { id: 11, kind: "markdown", title: "README", path: "/p/README.md" },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 10));
    expect(out.tabs).toEqual([
      { kind: "editor", id: 10, path: "/p/App.tsx" },
      { kind: "markdown", id: 11, path: "/p/README.md" },
    ]);
  });

  it("drops preview editor tabs", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        title: "Pinned",
        path: "/a",
        dirty: false,
        preview: false,
      },
      {
        id: 2,
        kind: "editor",
        title: "Preview",
        path: "/b",
        dirty: false,
        preview: true,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 2));
    expect(out.tabs.map((t) => t.id)).toEqual([1]);
    expect(out.activeTabId).toBe(2);
  });

  it("drops ai-diff, git-diff, git-history, git-commit-file, preview kinds", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
      },
      {
        id: 3,
        kind: "ai-diff",
        title: "diff",
        path: "/a",
        originalContent: "",
        proposedContent: "",
        approvalId: "x",
        status: "pending",
        isNewFile: false,
      },
      {
        id: 4,
        kind: "git-diff",
        title: "diff",
        path: "/a",
        repoRoot: "/r",
        mode: "-",
        originalPath: null,
      },
      { id: 5, kind: "git-history", title: "hist", repoRoot: "/r" },
      {
        id: 6,
        kind: "git-commit-file",
        title: "c",
        repoRoot: "/r",
        sha: "abc",
        shortSha: "abc",
        subject: "x",
        path: "/a",
        originalPath: null,
      },
      { id: 7, kind: "preview", title: "p", url: "https://x" },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs.map((t) => t.id)).toEqual([1]);
  });

  it("converts undefined cwds to null in the schema", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: undefined,
        paneTree: { kind: "leaf", id: 2, cwd: undefined },
        activeLeafId: 2,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs[0]).toMatchObject({
      cwd: null,
      paneTree: { kind: "leaf", id: 2, cwd: null },
    });
  });

  it("captures per-leaf scrollback snapshots from getSnapshot", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3 },
            { kind: "leaf", id: 4 },
          ],
        },
        activeLeafId: 3,
      },
    ];
    const snapshots: Record<number, string | null> = {
      3: "echo hi\r\nhi\r\n",
      4: null, // empty → omitted
    };
    const out = withFakeNow(() =>
      serializeSession(tabs, 1, (id) => snapshots[id] ?? null),
    );
    const tree = (out.tabs[0] as { paneTree: { children: unknown[] } }).paneTree;
    expect(tree.children[0]).toEqual({
      kind: "leaf",
      id: 3,
      cwd: null,
      snapshot: "echo hi\r\nhi\r\n",
    });
    // Leaf 4's snapshot was null, so the field is omitted entirely.
    expect(tree.children[1]).toEqual({ kind: "leaf", id: 4, cwd: null });
  });

  it("omits the snapshot field when no getSnapshot is provided", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs[0]).toMatchObject({
      paneTree: { kind: "leaf", id: 2, cwd: null },
    });
    expect(
      (out.tabs[0] as { paneTree: { snapshot?: string } }).paneTree.snapshot,
    ).toBeUndefined();
  });
});
