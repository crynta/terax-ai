import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it } from "vitest";
import {
  activeSpaceEnv,
  findActiveSpace,
  freshTabCwd,
  selectLaunchTab,
} from "./activeSpace";
import { freshTerminalTab } from "./serialize";
import type { SpaceMeta } from "./store";

describe("selectLaunchTab", () => {
  const local = { kind: "local" } as const;
  let id = 0;
  const allocId = () => ++id;

  it("opens the requested folder when a different terminal was restored", () => {
    const restored = [freshTerminalTab("s1", "C:/old", allocId)];
    const selected = selectLaunchTab(restored, "s1", local, "D:/work", allocId);
    expect(selected).toMatchObject({
      kind: "terminal",
      paneTree: { cwd: "D:/work" },
    });
    expect(restored).toHaveLength(1);
  });

  it("selects an existing match in the active space", () => {
    const other = freshTerminalTab("s2", "D:/work", allocId);
    const match = freshTerminalTab("s1", "D:/work", allocId);
    expect(
      selectLaunchTab([other, match], "s1", local, "D:/work", allocId),
    ).toBe(match);
  });

  it("leaves ordinary launches and WSL restores alone", () => {
    expect(
      selectLaunchTab([], "s1", local, undefined, allocId),
    ).toBeUndefined();
    expect(
      selectLaunchTab(
        [],
        "s1",
        { kind: "wsl", distro: "Ubuntu" },
        "D:/work",
        allocId,
      ),
    ).toBeUndefined();
  });

  it.each([
    ["D:\\work\\", "D:/work"],
    ["D:\\", "D:/"],
    ["\\\\server\\share\\", "//server/share"],
    ["/home/project/", "/home/project"],
  ])("reuses the terminal for equivalent paths %s and %s", (saved, target) => {
    const tab = freshTerminalTab("s1", saved, allocId);
    expect(selectLaunchTab([tab], "s1", local, target, allocId)).toBe(tab);
    expect(tab.paneTree).toMatchObject({ cwd: saved });
  });

  it.each([
    ["D:", "D:/"],
    ["D:/", "E:/"],
    ["/home/Project", "/home/project"],
    ["/home/a\\b", "/home/a/b"],
  ])("keeps distinct paths %s and %s separate", (saved, target) => {
    const tab = freshTerminalTab("s1", saved, allocId);
    expect(selectLaunchTab([tab], "s1", local, target, allocId)).not.toBe(tab);
  });
});

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
