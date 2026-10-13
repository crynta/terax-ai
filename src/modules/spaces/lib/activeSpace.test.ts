import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  activeSpaceEnv,
  applyExplicitLaunchDir,
  findActiveSpace,
  freshTabCwd,
} from "./activeSpace";
import type { SpaceMeta } from "./store";

function space(over: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "s1",
    name: "Space",
    root: null,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("findActiveSpace", () => {
  it("returns the space matching activeId", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, "b")?.id).toBe("b");
  });

  it("falls back to the first space when activeId is null or unknown", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, null)?.id).toBe("a");
    expect(findActiveSpace(spaces, "missing")?.id).toBe("a");
  });

  it("returns null when there are no spaces", () => {
    expect(findActiveSpace([], "a")).toBeNull();
  });
});

describe("activeSpaceEnv", () => {
  it("restores the active space's WSL env", () => {
    const spaces = [
      space({ id: "a", env: { kind: "local" } }),
      space({ id: "b", env: { kind: "wsl", distro: "Ubuntu" } }),
    ];
    expect(activeSpaceEnv(spaces, "b")).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
  });

  it("restores the env of the fallback space when activeId is missing", () => {
    const spaces = [space({ id: "a", env: { kind: "wsl", distro: "Debian" } })];
    expect(activeSpaceEnv(spaces, null)).toEqual({
      kind: "wsl",
      distro: "Debian",
    });
  });

  it("defaults to local when there are no spaces", () => {
    expect(activeSpaceEnv([], "a")).toEqual({ kind: "local" });
  });
});

describe("freshTabCwd", () => {
  const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  const local: WorkspaceEnv = { kind: "local" };

  it("prefers the restored home for any env", () => {
    expect(freshTabCwd(wsl, "/home/aj", "C:/Users/me", "C:/Users/me")).toBe(
      "/home/aj",
    );
  });

  it("returns null for a WSL space when its home did not resolve", () => {
    expect(freshTabCwd(wsl, null, "C:/Users/me", "C:/Users/me")).toBeNull();
  });

  it("falls back to the local launch cwd then home for a local space", () => {
    expect(freshTabCwd(local, null, "C:/work", "C:/Users/me")).toBe("C:/work");
    expect(freshTabCwd(local, null, null, "C:/Users/me")).toBe("C:/Users/me");
    expect(freshTabCwd(local, null, null, null)).toBeNull();
  });
});

describe("applyExplicitLaunchDir", () => {
  function ids(start = 10): () => number {
    let n = start;
    return () => n++;
  }

  function term(
    over: Partial<Extract<Tab, { kind: "terminal" }>>,
  ): Extract<Tab, { kind: "terminal" }> {
    return {
      id: 1,
      kind: "terminal",
      spaceId: "s1",
      title: "shell",
      cwd: "C:/old",
      paneTree: { kind: "leaf", id: 2, cwd: "C:/old" },
      activeLeafId: 2,
      ...over,
    };
  }

  it("activates an existing local space whose root matches the explicit launch dir", () => {
    const spaces = [
      space({ id: "old", root: "C:/old" }),
      space({ id: "repo", root: "c:\\work\\repo\\" }),
    ];
    const tabs: Tab[] = [
      term({ id: 1, spaceId: "old", cwd: "C:/old" }),
      term({
        id: 3,
        spaceId: "repo",
        cwd: "C:/work/repo",
        paneTree: { kind: "leaf", id: 4, cwd: "C:/work/repo" },
        activeLeafId: 4,
      }),
    ];

    const result = applyExplicitLaunchDir({
      spaces,
      tabs,
      launchDir: "C:/work/repo",
      allocId: ids(),
      now: () => 100,
      newSpaceId: () => "new",
    });

    expect(result.activeSpaceId).toBe("repo");
    expect(result.activeTabId).toBe(3);
    expect(result.spaces).toHaveLength(2);
    expect(result.tabs).toHaveLength(2);
  });

  it("creates a local space when no existing local root matches", () => {
    const result = applyExplicitLaunchDir({
      spaces: [space({ id: "old", root: "C:/old" })],
      tabs: [term({ id: 1, spaceId: "old" })],
      launchDir: "D:/work/new-repo",
      allocId: ids(20),
      now: () => 123,
      newSpaceId: () => "sp-new",
    });

    expect(result.activeSpaceId).toBe("sp-new");
    const created = result.spaces[result.spaces.length - 1];
    const createdTab = result.tabs[result.tabs.length - 1];
    expect(created).toMatchObject({
      id: "sp-new",
      name: "new-repo",
      root: "D:/work/new-repo",
      env: { kind: "local" },
      createdAt: 123,
      updatedAt: 123,
    });
    expect(createdTab).toMatchObject({
      kind: "terminal",
      spaceId: "sp-new",
      cwd: "D:/work/new-repo",
    });
    expect(result.activeTabId).toBe(createdTab?.id);
  });

  it("does not match a WSL space for a local explicit launch dir", () => {
    const result = applyExplicitLaunchDir({
      spaces: [
        space({
          id: "wsl",
          root: "C:/work/repo",
          env: { kind: "wsl", distro: "Ubuntu" },
        }),
      ],
      tabs: [],
      launchDir: "C:/work/repo",
      allocId: ids(30),
      now: () => 456,
      newSpaceId: () => "local",
    });

    expect(result.activeSpaceId).toBe("local");
    expect(result.spaces.map((s) => s.id)).toEqual(["wsl", "local"]);
  });

  it("adds and activates a terminal when the matched space has no launch-dir tab", () => {
    const result = applyExplicitLaunchDir({
      spaces: [space({ id: "repo", root: "C:/work/repo" })],
      tabs: [
        term({
          id: 1,
          spaceId: "repo",
          cwd: "C:/work/repo/subdir",
          paneTree: { kind: "leaf", id: 2, cwd: "C:/work/repo/subdir" },
        }),
      ],
      launchDir: "C:/work/repo",
      allocId: ids(40),
      now: () => 789,
      newSpaceId: () => "new",
    });

    expect(result.activeSpaceId).toBe("repo");
    expect(result.tabs).toHaveLength(2);
    const added = result.tabs[result.tabs.length - 1];
    expect(added).toMatchObject({
      kind: "terminal",
      spaceId: "repo",
      cwd: "C:/work/repo",
    });
    expect(result.activeTabId).toBe(added?.id);
  });
});
