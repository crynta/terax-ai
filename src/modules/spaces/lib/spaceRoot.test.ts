import { describe, expect, it, vi } from "vitest";
import {
  hasUsableSpaceRoot,
  legacyRootCandidate,
  migrateSpaceRoots,
  validatePersistedSpaceRoots,
} from "@/modules/spaces/lib/spaceRoot";
import type {
  LoadedSpaces,
  SpaceMeta,
  SpaceState,
} from "@/modules/spaces/lib/store";

function space(overrides: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "space",
    name: "Space",
    root: null,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function terminalState(cwd: string): SpaceState {
  return {
    activeTabIndex: 0,
    tabs: [{ kind: "terminal", tree: { kind: "leaf", cwd, active: true } }],
  };
}

function loadedSpaces(): LoadedSpaces {
  return {
    schemaVersion: 1,
    activeId: "ok",
    spaces: [
      space({ id: "ok", root: "/project" }),
      space({ id: "missing", root: "/missing" }),
    ],
    states: new Map(),
  };
}

describe("legacyRootCandidate", () => {
  it("uses the active terminal leaf before another terminal leaf", () => {
    const state: SpaceState = {
      activeTabIndex: 1,
      tabs: [
        { kind: "terminal", tree: { kind: "leaf", cwd: "/first" } },
        {
          kind: "terminal",
          tree: { kind: "leaf", cwd: "/active", active: true },
        },
      ],
    };
    expect(legacyRootCandidate(space({ root: null }), state, "/home/me")).toBe(
      "/active",
    );
  });

  it("keeps an existing Space root ahead of terminal cwd", () => {
    expect(
      legacyRootCandidate(
        space({ root: "/project" }),
        terminalState("/shell"),
        "/home/me",
      ),
    ).toBe("/project");
  });

  it("uses the first terminal leaf when no active terminal leaf exists", () => {
    const state: SpaceState = {
      activeTabIndex: 0,
      tabs: [
        {
          kind: "terminal",
          tree: {
            kind: "split",
            dir: "row",
            children: [
              { kind: "leaf", cwd: "/first" },
              { kind: "leaf", cwd: "/second" },
            ],
          },
        },
      ],
    };
    expect(legacyRootCandidate(space({}), state, "/home/me")).toBe("/first");
  });

  it("uses the environment home when no terminal cwd exists", () => {
    expect(legacyRootCandidate(space({}), undefined, "/home/me")).toBe(
      "/home/me",
    );
  });
});

describe("migrateSpaceRoots", () => {
  it("writes canonical roots and records unavailable candidates", async () => {
    const result = await migrateSpaceRoots(
      loadedSpaces(),
      async () => "/home/me",
      async (path) => {
        if (path === "/missing") throw new Error("not found");
        return `/canon${path}`;
      },
    );

    expect(result.spaces.find((s) => s.id === "ok")?.root).toBe(
      "/canon/project",
    );
    expect(result.issues.missing).toEqual({
      candidate: "/missing",
      message: "not found",
    });
  });

  it("passes each Space env to root validation", async () => {
    const env = { kind: "wsl", distro: "Ubuntu" } as const;
    const calls: Array<{ path: string; env: SpaceMeta["env"] }> = [];
    await migrateSpaceRoots(
      {
        schemaVersion: 1,
        activeId: "space",
        spaces: [space({ root: "/home/me/project", env })],
        states: new Map(),
      },
      async () => null,
      async (path, validationEnv) => {
        calls.push({ path, env: validationEnv });
        return path;
      },
    );

    expect(calls).toEqual([{ path: "/home/me/project", env }]);
  });

  it("migrates a legacy rootless Space to its validated environment Home", async () => {
    const env = { kind: "wsl", distro: "Ubuntu" } as const;
    const resolveHome = vi.fn(async () => "/home/me");
    const validateRoot = vi.fn(async (path: string) => `/canonical${path}`);

    const result = await migrateSpaceRoots(
      {
        schemaVersion: 1,
        activeId: "legacy",
        spaces: [space({ id: "legacy", env })],
        states: new Map(),
      },
      resolveHome,
      validateRoot,
    );

    expect(resolveHome).toHaveBeenCalledWith(env);
    expect(validateRoot).toHaveBeenCalledWith("/home/me", env);
    expect(result.spaces[0].root).toBe("/canonical/home/me");
    expect(result.issues).toEqual({});
  });

  it("preserves a terminal candidate when validation fails", async () => {
    const loaded: LoadedSpaces = {
      schemaVersion: 1,
      activeId: "space",
      spaces: [space({ root: null })],
      states: new Map([["space", terminalState("/unavailable")]]),
    };
    const result = await migrateSpaceRoots(
      loaded,
      async () => "/home/me",
      async () => {
        throw new Error("not found");
      },
    );

    expect(result.spaces[0].root).toBe("/unavailable");
    expect(result.issues.space).toEqual({
      candidate: "/unavailable",
      message: "not found",
    });
  });
});

describe("validatePersistedSpaceRoots", () => {
  it("reconstructs unavailable state from schema-v2 roots without terminal cwd", async () => {
    const unavailable = space({
      id: "unavailable",
      root: "/missing",
      env: { kind: "wsl", distro: "Ubuntu" },
    });
    const noRoot = space({ id: "no-root", root: null });
    const calls: Array<{ path: string; env: SpaceMeta["env"] }> = [];
    const issues = await validatePersistedSpaceRoots(
      [unavailable, noRoot],
      async (path, env) => {
        calls.push({ path, env });
        throw new Error("not found");
      },
    );

    expect(calls).toEqual([{ path: "/missing", env: unavailable.env }]);
    expect(issues).toEqual({
      unavailable: { candidate: "/missing", message: "not found" },
      "no-root": { candidate: null, message: "No directory is available" },
    });
  });

  it("accepts a successfully revalidated schema-v2 root", async () => {
    const env = { kind: "wsl", distro: "Ubuntu" } as const;
    const persisted = space({ id: "persisted", root: "/home/me/project", env });
    const validateRoot = vi.fn(async () => "/home/me/project");

    const issues = await validatePersistedSpaceRoots([persisted], validateRoot);

    expect(validateRoot).toHaveBeenCalledOnce();
    expect(validateRoot).toHaveBeenCalledWith("/home/me/project", env);
    expect(issues).toEqual({});
  });
});

describe("hasUsableSpaceRoot", () => {
  it("does not create a fresh terminal for an unavailable active root", () => {
    const unavailable = space({ root: "/missing" });
    expect(
      hasUsableSpaceRoot(unavailable, {
        space: { candidate: "/missing", message: "not found" },
      }),
    ).toBe(false);
    expect(hasUsableSpaceRoot(space({ root: "/project" }), {})).toBe(true);
  });
});
