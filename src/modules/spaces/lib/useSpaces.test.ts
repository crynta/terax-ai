import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceMeta } from "@/modules/spaces/lib/store";

vi.mock("@/modules/spaces/lib/store", () => ({
  deleteSpaceData: vi.fn(),
  newSpaceId: () => "generated",
  saveActiveId: vi.fn(),
  saveSpacesList: vi.fn(),
}));

import * as spacesModule from "@/modules/spaces/lib/useSpaces";
import type { SpaceRootIssues } from "@/modules/spaces/lib/spaceRoot";

const { useSpaces } = spacesModule;

function makeSpace(id: string, root: string | null): SpaceMeta {
  return {
    id,
    name: id,
    root,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
  };
}

function seedSpaces(
  spaces: SpaceMeta[],
  rootIssues: SpaceRootIssues = {},
): void {
  useSpaces.setState({
    spaces,
    activeId: spaces[0]?.id ?? null,
    hydrated: true,
    persistenceBlocked: false,
    initialActiveIndex: {},
    rootIssues,
  });
}

afterEach(() => {
  seedSpaces([]);
});

describe("Space persistence policy", () => {
  it("blocks persistence for an unhydrated or synthetic fallback session", () => {
    const canPersistSpaceState = (
      spacesModule as typeof spacesModule & {
        canPersistSpaceState(
          hydrated: boolean,
          persistenceBlocked: boolean,
        ): boolean;
      }
    ).canPersistSpaceState;

    expect(canPersistSpaceState(false, false)).toBe(false);
    expect(canPersistSpaceState(true, true)).toBe(false);
    expect(canPersistSpaceState(true, false)).toBe(true);
  });
});

describe("useSpaces hydration", () => {
  it("can block tab persistence for a synthetic boot fallback", () => {
    const hydrate = useSpaces.getState().hydrate as (
      spaces: SpaceMeta[],
      activeId: string | null,
      initialActiveIndex: Record<string, number>,
      rootIssues: SpaceRootIssues,
      persistenceBlocked: boolean,
    ) => void;

    hydrate([makeSpace("broken", "/broken")], "broken", {}, {}, true);

    expect(
      (
        useSpaces.getState() as ReturnType<typeof useSpaces.getState> & {
          persistenceBlocked?: boolean;
        }
      ).persistenceBlocked,
    ).toBe(true);
  });
});

describe("useSpaces compatibility", () => {
  it("retains environment mutation while App still uses it", () => {
    seedSpaces([makeSpace("a", "/a"), makeSpace("b", "/b")]);

    useSpaces.getState().setEnv("a", { kind: "wsl", distro: "Ubuntu" });

    expect(useSpaces.getState().spaces.map((space) => space.env)).toEqual([
      { kind: "wsl", distro: "Ubuntu" },
      { kind: "local" },
    ]);
  });
});

describe("useSpaces root mutations", () => {
  it("changes only the selected Space root and clears its issue", () => {
    seedSpaces([makeSpace("a", "/a"), makeSpace("b", "/b")], {
      a: { candidate: "/missing", message: "not found" },
    });

    useSpaces.getState().setRoot("a", "/next");

    expect(useSpaces.getState().spaces.map((space) => space.root)).toEqual([
      "/next",
      "/b",
    ]);
    expect(useSpaces.getState().rootIssues.a).toBeUndefined();
  });

  it("sets and clears individual root issues", () => {
    seedSpaces([makeSpace("a", "/a"), makeSpace("b", "/b")]);

    useSpaces
      .getState()
      .setRootIssue("a", { candidate: "/missing", message: "not found" });
    useSpaces.getState().clearRootIssue("a");

    expect(useSpaces.getState().rootIssues).toEqual({});
  });
});
