import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSpaces, SpaceMeta } from "@/modules/spaces/lib/store";

const mocks = vi.hoisted(() => ({
  canonicalize: vi.fn(),
  stat: vi.fn(),
  workspaceAuthorize: vi.fn(),
  loadAll: vi.fn(),
  saveSpacesList: vi.fn(),
  hydrate: vi.fn(),
  defaultWorkspaceEnv: "local",
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const react = actual as typeof actual & { default: typeof actual };
  return {
    ...react.default,
    ...actual,
    useEffect: (effect: () => void) => effect(),
    useRef: <T>(value: T) => ({ current: value }),
  };
});

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    canonicalize: mocks.canonicalize,
    stat: mocks.stat,
    workspaceAuthorize: mocks.workspaceAuthorize,
  },
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({
      init: vi.fn().mockResolvedValue(undefined),
      defaultWorkspaceEnv: mocks.defaultWorkspaceEnv,
    }),
  },
}));

vi.mock("@/modules/spaces/lib/store", () => ({
  loadAll: mocks.loadAll,
  normalizeSpaceEnvs: (
    spaces: Array<SpaceMeta | Record<string, unknown>>,
    fallbackEnv: SpaceMeta["env"],
  ) =>
    spaces.map((space) => {
      const env = space.env;
      const validEnv =
        env !== null &&
        typeof env === "object" &&
        ((env as { kind?: unknown }).kind === "local" ||
          ((env as { kind?: unknown }).kind === "wsl" &&
            typeof (env as { distro?: unknown }).distro === "string"));
      return validEnv ? space : { ...space, env: fallbackEnv };
    }),
  saveActiveId: vi.fn(),
  saveSchemaVersion: vi.fn(),
  saveSpacesList: mocks.saveSpacesList,
}));

vi.mock("@/modules/spaces/lib/useSpaces", () => ({
  useSpaces: {
    getState: () => ({ hydrate: mocks.hydrate }),
  },
}));

vi.mock("@/modules/tabs/lib/useTabs", () => ({
  DEFAULT_SPACE_ID: "default",
}));

import * as bootModule from "./useSpacesBoot";

const { useSpacesBoot } = bootModule;

function space(overrides: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "broken",
    name: "Broken",
    root: "/rejected",
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function loadedWithNoState(): LoadedSpaces {
  return {
    schemaVersion: 2,
    activeId: "broken",
    spaces: [space({})],
    states: new Map(),
  };
}

describe("workspace cwd authorization", () => {
  it("keeps equal cwd values distinct across owning Space environments", () => {
    const workspaceCwdsForTabs = (
      bootModule as typeof bootModule & {
        workspaceCwdsForTabs(
          tabs: Array<{
            kind: "terminal";
            spaceId: string;
            paneTree: { kind: "leaf"; id: number; cwd: string };
          }>,
          spaces: SpaceMeta[],
        ): Array<{ cwd: string; env: SpaceMeta["env"] }>;
      }
    ).workspaceCwdsForTabs;
    const spaces = [
      space({ id: "local", root: "/same", env: { kind: "local" } }),
      space({
        id: "wsl",
        root: "/same",
        env: { kind: "wsl", distro: "Ubuntu" },
      }),
    ];

    expect(
      workspaceCwdsForTabs(
        [
          {
            kind: "terminal",
            spaceId: "local",
            paneTree: { kind: "leaf", id: 1, cwd: "/same" },
          },
          {
            kind: "terminal",
            spaceId: "wsl",
            paneTree: { kind: "leaf", id: 2, cwd: "/same" },
          },
        ],
        spaces,
      ),
    ).toEqual([
      { cwd: "/same", env: { kind: "local" } },
      { cwd: "/same", env: { kind: "wsl", distro: "Ubuntu" } },
    ]);
  });
});

describe("restored cwd authorization", () => {
  it("passes each owning Space environment to native authorization", async () => {
    const authorizeWorkspaceCwds = (
      bootModule as typeof bootModule & {
        authorizeWorkspaceCwds(
          tabs: Array<{
            kind: "terminal";
            spaceId: string;
            paneTree: { kind: "leaf"; id: number; cwd: string };
          }>,
          spaces: SpaceMeta[],
          authorize: (cwd: string, env: SpaceMeta["env"]) => Promise<unknown>,
        ): Promise<void>;
      }
    ).authorizeWorkspaceCwds;
    const authorize = vi.fn().mockResolvedValue(undefined);
    const spaces = [
      space({ id: "local", root: "/same", env: { kind: "local" } }),
      space({
        id: "wsl",
        root: "/same",
        env: { kind: "wsl", distro: "Ubuntu" },
      }),
    ];

    await authorizeWorkspaceCwds(
      [
        {
          kind: "terminal",
          spaceId: "local",
          paneTree: { kind: "leaf", id: 1, cwd: "/same" },
        },
        {
          kind: "terminal",
          spaceId: "wsl",
          paneTree: { kind: "leaf", id: 2, cwd: "/same" },
        },
      ],
      spaces,
      authorize,
    );

    expect(authorize.mock.calls).toEqual([
      ["/same", { kind: "local" }],
      ["/same", { kind: "wsl", distro: "Ubuntu" }],
    ]);
  });
});

describe("useSpacesBoot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.defaultWorkspaceEnv = "local";
    mocks.stat.mockResolvedValue({ size: 0, mtime: 0, kind: "dir" });
  });

  it("uses environment Home as the first Space root and terminal cwd", async () => {
    mocks.loadAll.mockResolvedValue({
      schemaVersion: 2,
      activeId: null,
      spaces: [],
      states: new Map(),
    });
    mocks.canonicalize.mockImplementation(async (path: string) => path);
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const markBooted = vi.fn();
    const replaceTabs = vi.fn();
    const adoptWorkspaceEnv = vi.fn().mockResolvedValue("/env-home");

    useSpacesBoot({
      ready: true,
      home: "/local-home",
      allocId: () => 1,
      replaceTabs,
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv,
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(mocks.saveSpacesList).toHaveBeenCalledWith([
      expect.objectContaining({ id: "default", root: "/env-home" }),
    ]);
    expect(mocks.hydrate).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "default", root: "/env-home" })],
      "default",
      {},
      {},
    );
    expect(replaceTabs).toHaveBeenCalledOnce();
    const [[tab], activeTabId] = replaceTabs.mock.calls[0] as [
      [
        {
          id: number;
          spaceId: string;
          cold: boolean;
          cwd?: string;
          paneTree: { kind: "leaf"; cwd?: string };
        },
      ],
      number,
    ];
    expect(tab).toMatchObject({
      spaceId: "default",
      cold: true,
      cwd: "/env-home",
      paneTree: { kind: "leaf", cwd: "/env-home" },
    });
    expect(activeTabId).toBe(tab.id);
  });

  it("does not substitute local Home when WSL Home is unavailable", async () => {
    mocks.defaultWorkspaceEnv = "wsl:Ubuntu";
    mocks.loadAll.mockResolvedValue({
      schemaVersion: 2,
      activeId: null,
      spaces: [],
      states: new Map(),
    });
    mocks.canonicalize.mockImplementation(async (path: string) => path);
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const markBooted = vi.fn();

    useSpacesBoot({
      ready: true,
      home: "/Users/me",
      allocId: () => 1,
      replaceTabs: vi.fn(),
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: vi.fn().mockResolvedValue(null),
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(mocks.saveSpacesList).toHaveBeenCalledWith([
      expect.objectContaining({ id: "default", root: null }),
    ]);
    expect(mocks.hydrate).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "default", root: null })],
      "default",
      {},
      {
        default: {
          candidate: null,
          message: "No directory is available",
        },
      },
    );
    expect(mocks.canonicalize).not.toHaveBeenCalledWith("/Users/me", {
      kind: "wsl",
      distro: "Ubuntu",
    });
  });

  it("does not repair a persisted WSL root with Local Home", async () => {
    const wsl = space({
      id: "wsl",
      name: "WSL",
      root: "/rejected",
      env: { kind: "wsl", distro: "Ubuntu" },
    });
    mocks.loadAll.mockResolvedValue({
      schemaVersion: 2,
      activeId: "wsl",
      spaces: [wsl],
      states: new Map(),
    });
    mocks.canonicalize.mockImplementation(async (path: string) => {
      if (path === "/rejected") throw new Error("not found");
      return path;
    });
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const markBooted = vi.fn();

    useSpacesBoot({
      ready: true,
      home: "/Users/me",
      allocId: (() => {
        let id = 1;
        return () => id++;
      })(),
      replaceTabs: vi.fn(),
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: vi.fn().mockResolvedValue(null),
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(mocks.canonicalize).not.toHaveBeenCalledWith("/Users/me", {
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(mocks.saveSpacesList).not.toHaveBeenCalledWith([
      expect.objectContaining({ id: "wsl", root: "/Users/me" }),
    ]);
    expect(mocks.hydrate).toHaveBeenCalledWith(
      [wsl],
      "wsl",
      {},
      {
        wsl: {
          candidate: "/rejected",
          message: expect.any(String),
        },
      },
      true,
    );
  });

  it("preserves a valid schema-v2 environment instead of applying the fallback", async () => {
    mocks.defaultWorkspaceEnv = "wsl:Ubuntu";
    const persisted = space({ id: "persisted", root: "/repo" });
    mocks.loadAll.mockResolvedValue({
      schemaVersion: 2,
      activeId: "persisted",
      spaces: [persisted],
      states: new Map(),
    });
    mocks.canonicalize.mockImplementation(async (path: string) => path);
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const markBooted = vi.fn();

    useSpacesBoot({
      ready: true,
      home: "/home",
      allocId: () => 1,
      replaceTabs: vi.fn(),
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: vi.fn().mockResolvedValue("/home"),
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(mocks.canonicalize).toHaveBeenCalledWith("/repo", {
      kind: "local",
    });
    expect(mocks.saveSpacesList).not.toHaveBeenCalled();
  });

  it("keeps persisted tabs unmounted when active environment adoption fails", async () => {
    const wsl = space({
      id: "wsl",
      name: "WSL",
      root: "/work",
      env: { kind: "wsl", distro: "Ubuntu" },
    });
    mocks.loadAll.mockResolvedValue({
      schemaVersion: 2,
      activeId: "wsl",
      spaces: [wsl],
      states: new Map([
        [
          "wsl",
          {
            tabs: [{ kind: "editor", path: "/work/main.ts" }],
            activeTabIndex: 0,
          },
        ],
      ]),
    });
    mocks.canonicalize.mockImplementation(async (path: string) => path);
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const markBooted = vi.fn();
    const replaceTabs = vi.fn();

    useSpacesBoot({
      ready: true,
      home: "/Users/me",
      allocId: (() => {
        let id = 1;
        return () => id++;
      })(),
      replaceTabs,
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: vi.fn().mockResolvedValue(null),
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(mocks.hydrate).toHaveBeenCalledWith(
      [wsl],
      "wsl",
      { wsl: 0 },
      {
        wsl: {
          candidate: "/work",
          message: expect.any(String),
        },
      },
      true,
    );
    const [tabs] = replaceTabs.mock.calls[0] as [
      Array<{
        kind: string;
        cold?: boolean;
        cwd?: string;
        paneTree?: { kind: string; cwd?: string };
      }>,
    ];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      kind: "terminal",
      cold: true,
      cwd: undefined,
      paneTree: { kind: "leaf" },
    });
    expect(tabs[0]).not.toHaveProperty("path");
  });

  it("normalizes a schema-v1 Space lacking env before resolving and validating Home", async () => {
    const legacySpace = {
      id: "legacy",
      name: "Legacy",
      root: null,
      createdAt: 0,
      updatedAt: 0,
    };
    mocks.loadAll.mockResolvedValue({
      schemaVersion: 1,
      activeId: "legacy",
      spaces: [legacySpace],
      states: new Map(),
    });
    mocks.canonicalize.mockImplementation(async (path: string) => path);
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const adoptWorkspaceEnv = vi.fn().mockResolvedValue("/fallback-home");
    const markBooted = vi.fn();

    useSpacesBoot({
      ready: true,
      home: "/local-home",
      allocId: () => 1,
      replaceTabs: vi.fn(),
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv,
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    const fallbackEnv = { kind: "local" };
    expect(adoptWorkspaceEnv).toHaveBeenCalledWith(fallbackEnv);
    expect(mocks.canonicalize).toHaveBeenCalledWith(
      "/fallback-home",
      fallbackEnv,
    );
    expect(mocks.stat).toHaveBeenCalledWith("/fallback-home", fallbackEnv);
    expect(mocks.workspaceAuthorize).toHaveBeenCalledWith(
      "/fallback-home",
      fallbackEnv,
    );
    expect(mocks.saveSpacesList).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "legacy",
        root: "/fallback-home",
        env: fallbackEnv,
      }),
    ]);
  });

  it("recovers a persisted file root to environment Home", async () => {
    mocks.loadAll.mockResolvedValue(loadedWithNoState());
    mocks.canonicalize.mockImplementation(async (path: string) => path);
    mocks.stat.mockImplementation(async (path: string) => ({
      size: 0,
      mtime: 0,
      kind: path === "/rejected" ? "file" : "dir",
    }));
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const markBooted = vi.fn();
    const replaceTabs = vi.fn();

    useSpacesBoot({
      ready: true,
      home: "/home",
      allocId: () => 1,
      replaceTabs,
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: vi.fn().mockResolvedValue("/home"),
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(mocks.stat).toHaveBeenCalledWith("/rejected", { kind: "local" });
    expect(mocks.workspaceAuthorize).not.toHaveBeenCalledWith("/rejected", {
      kind: "local",
    });
    expect(mocks.saveSpacesList).toHaveBeenCalledWith([
      expect.objectContaining({ id: "broken", root: "/home" }),
    ]);
    expect(mocks.hydrate).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "broken", root: "/home" })],
      "broken",
      {},
      {},
      false,
    );
    expect(replaceTabs).toHaveBeenCalledWith(
      [expect.objectContaining({ cwd: "/home" })],
      expect.any(Number),
    );
  });

  it("recovers an unavailable persisted root to environment Home", async () => {
    mocks.loadAll.mockResolvedValue(loadedWithNoState());
    mocks.canonicalize.mockImplementation(async (path: string) => {
      if (path === "/rejected") throw new Error("not found");
      return path;
    });
    mocks.workspaceAuthorize.mockResolvedValue(undefined);
    const replaceTabs = vi.fn();
    const markBooted = vi.fn();
    const setActiveSpaceForNewTabs = vi.fn();
    const adoptWorkspaceEnv = vi.fn().mockResolvedValue("/home");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    useSpacesBoot({
      ready: true,
      home: "/home",
      allocId: (() => {
        let id = 1;
        return () => id++;
      })(),
      replaceTabs,
      markBooted,
      setActiveSpaceForNewTabs,
      adoptWorkspaceEnv,
    });

    await vi.waitFor(() => expect(markBooted).toHaveBeenCalledOnce());

    expect(consoleError).not.toHaveBeenCalled();
    expect(setActiveSpaceForNewTabs).toHaveBeenCalledWith("broken");
    expect(replaceTabs).toHaveBeenCalledOnce();
    const [tabs] = replaceTabs.mock.calls[0] as [
      Array<{
        spaceId: string;
        cold?: boolean;
        cwd?: string;
        paneTree: { kind: "leaf"; cwd?: string };
      }>,
    ];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      spaceId: "broken",
      cold: true,
      cwd: "/home",
      paneTree: { kind: "leaf", cwd: "/home" },
    });
    expect(mocks.saveSpacesList).toHaveBeenCalledWith([
      expect.objectContaining({ id: "broken", root: "/home" }),
    ]);
    expect(mocks.hydrate).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "broken", root: "/home" })],
      "broken",
      {},
      {},
      false,
    );
    expect(mocks.workspaceAuthorize).toHaveBeenCalledWith("/home", {
      kind: "local",
    });

    consoleError.mockRestore();
  });
});
