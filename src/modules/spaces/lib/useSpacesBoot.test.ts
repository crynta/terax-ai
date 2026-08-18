import type { Tab } from "@/modules/tabs/lib/useTabs";
import { describe, expect, it, vi } from "vitest";
import type { SpaceMeta, SpaceState } from "./store";
import { bootSpaces } from "./useSpacesBoot";

function space(over: Partial<SpaceMeta> = {}): SpaceMeta {
  return {
    id: "repo",
    name: "Repo",
    root: "C:/work/repo",
    env: { kind: "local" },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function state(cwd: string): SpaceState {
  return {
    tabs: [
      {
        kind: "terminal",
        tree: { kind: "leaf", cwd, active: true },
      },
    ],
    activeTabIndex: 0,
  };
}

function ids(start = 10): () => number {
  let next = start;
  return () => next++;
}

function setup(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const spaces = [
    space(),
    space({ id: "other", name: "Other", root: "C:/work/other" }),
  ];
  const deps = {
    loadAll: vi.fn().mockResolvedValue({
      spaces,
      activeId: "repo",
      states: new Map([
        ["repo", state("C:/work/repo")],
        ["other", state("C:/work/other")],
      ]),
    }),
    saveSpacesList: vi.fn(async () => {
      events.push("save-spaces");
    }),
    saveActiveId: vi.fn(async () => {
      events.push("save-active");
    }),
    workspaceAuthorize: vi.fn(async (cwd: string) => {
      events.push(`authorize:${cwd}`);
      return cwd;
    }),
    hydrate: vi.fn(() => {
      events.push("hydrate");
    }),
    ...overrides,
  };
  const params = {
    launchCwd: "C:/fallback",
    explicitLaunchDir: "C:/work/repo",
    home: "C:/Users/test",
    allocId: ids(),
    replaceTabs: vi.fn((_: Tab[], __: number) => {
      events.push("replace-tabs");
    }),
    setActiveSpaceForNewTabs: vi.fn(),
    adoptWorkspaceEnv: vi.fn(async () => {
      events.push("adopt-local");
      return "C:/Users/test";
    }),
  };
  return { deps, events, params, spaces };
}

describe("bootSpaces explicit launch", () => {
  it("adopts local workspace and hydrates before replacing tabs", async () => {
    const { deps, events, params, spaces } = setup();

    await bootSpaces(params, deps);

    expect(params.adoptWorkspaceEnv).toHaveBeenCalledWith({ kind: "local" });
    expect(params.setActiveSpaceForNewTabs).toHaveBeenCalledWith("repo");
    expect(deps.saveSpacesList).toHaveBeenCalledWith(spaces);
    expect(deps.saveActiveId).toHaveBeenCalledWith("repo");
    expect(deps.workspaceAuthorize.mock.calls).toEqual([
      ["C:/work/repo"],
      ["C:/work/other"],
    ]);
    expect(events.indexOf("adopt-local")).toBeLessThan(
      events.indexOf("authorize:C:/work/repo"),
    );
    expect(events.indexOf("authorize:C:/work/other")).toBeLessThan(
      events.indexOf("hydrate"),
    );
    expect(events.indexOf("save-active")).toBeLessThan(
      events.indexOf("hydrate"),
    );
    expect(events.indexOf("hydrate")).toBeLessThan(
      events.indexOf("replace-tabs"),
    );
    expect(params.replaceTabs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "terminal",
          spaceId: "repo",
          cwd: "C:/work/repo",
        }),
      ]),
      11,
    );
  });

  it("uses the explicit launch directory for the first default space", async () => {
    const { deps, params } = setup({
      loadAll: vi.fn().mockResolvedValue({
        spaces: [],
        activeId: null,
        states: new Map(),
      }),
    });

    await bootSpaces(params, deps);

    expect(deps.saveSpacesList).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "default",
        root: "C:/work/repo",
        env: { kind: "local" },
      }),
    ]);
    expect(deps.hydrate).toHaveBeenCalledWith(
      [expect.objectContaining({ root: "C:/work/repo" })],
      "default",
    );
  });

  it("hydrates and replaces tabs when external operations fail", async () => {
    const { deps, events, params, spaces } = setup({
      saveSpacesList: vi.fn().mockRejectedValue(new Error("save spaces")),
      saveActiveId: vi.fn().mockRejectedValue(new Error("save active")),
      workspaceAuthorize: vi.fn().mockRejectedValue(new Error("authorize")),
    });
    params.adoptWorkspaceEnv.mockRejectedValue(new Error("adopt"));

    await bootSpaces(params, deps);

    expect(deps.saveSpacesList).toHaveBeenCalledWith(spaces);
    expect(deps.saveActiveId).toHaveBeenCalledWith("repo");
    expect(deps.workspaceAuthorize).toHaveBeenCalledWith("C:/work/repo");
    expect(deps.hydrate).toHaveBeenCalledWith(spaces, "repo", {
      repo: 0,
      other: 0,
    });
    expect(params.replaceTabs).toHaveBeenCalledOnce();
    expect(events).toEqual(["hydrate", "replace-tabs"]);
  });
});
