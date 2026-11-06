import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SpaceMeta } from "@/modules/spaces/lib/store";
const data = vi.hoisted(() => ({
  spaces: [] as SpaceMeta[],
  defaultEnv: "wsl:Ubuntu",
  hydrated: false,
  load: vi.fn(),
  save: vi.fn(),
  authorize: vi.fn(),
  ensure: vi.fn(),
  booted: vi.fn(),
  hydrate: vi.fn(),
  adopt: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { workspaceAuthorize: data.authorize },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({
      init: async () => {},
      defaultWorkspaceEnv: data.defaultEnv,
    }),
  },
}));
vi.mock("@/modules/spaces/lib/store", () => ({
  loadAll: data.load,
  saveSpacesList: data.save,
  saveActiveId: vi.fn(),
  flushSpacesStore: vi.fn(),
  saveWorkbenchBackup: vi.fn(),
}));
vi.mock("@/modules/spaces/lib/useSpaces", () => ({
  useSpaces: {
    getState: () => ({
      hydrated: data.hydrated,
      activeId: null,
      hydrate: data.hydrate,
    }),
  },
}));
vi.mock("./actions", () => ({ ensureProjectHasMain: data.ensure }));
vi.mock("./store", () => ({
  allocId: () => 1,
  hydrateWorkbench: vi.fn(),
  markBooted: data.booted,
  snapshot: () => ({ tasks: [] }),
}));
vi.mock("./useWorkbenchPersistence", () => ({
  preventProjectOverwrite: vi.fn(),
  rememberLegacyFingerprint: vi.fn(),
}));
vi.mock("./model/restore", () => ({
  restoreProject: async (
    _stored: unknown,
    _legacy: unknown,
    projectId: string,
  ) => ({
    backup: false,
    legacy: null,
    project: {
      dropped: 0,
      activeTaskId: null,
      tasks: [],
      tabs: [
        {
          id: projectId === "wsl" ? 1 : 2,
          kind: "terminal",
          spaceId: projectId,
          title: "shell",
          cwd: "/outside/home",
          cold: true,
        },
      ],
    },
  }),
}));
import { useWorkbenchBoot } from "./useWorkbenchBoot";

beforeEach(() => {
  vi.clearAllMocks();
  data.spaces = [];
  data.hydrated = false;
  data.defaultEnv = "wsl:Ubuntu";
  data.adopt.mockResolvedValue("/home/linux");
  data.save.mockResolvedValue(undefined);
  data.load.mockImplementation(async () => ({
    spaces: data.spaces,
    activeId: "local",
    workbench: new Map(),
    legacy: new Map(),
  }));
  data.hydrate.mockImplementation(() => {
    data.hydrated = true;
  });
});
async function boot() {
  function Probe() {
    useWorkbenchBoot({
      ready: true,
      launchCwd: "C:/launch",
      home: "C:/home",
      adoptWorkspaceEnv: data.adopt,
    });
    return null;
  }
  renderToString(createElement(Probe));
  await vi.waitFor(() => expect(data.booted).toHaveBeenCalledOnce());
}

it.each(["/home/linux", null])(
  "adopts the default WSL environment before creating the main task: %s",
  async (home) => {
    data.adopt.mockResolvedValue(home);
    await boot();
    expect(data.adopt).toHaveBeenCalledExactlyOnceWith({
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(data.save).toHaveBeenCalledWith([
      expect.objectContaining({
        root: home,
        env: { kind: "wsl", distro: "Ubuntu" },
      }),
    ]);
    expect(data.ensure).toHaveBeenCalledExactlyOnceWith(
      "default",
      home ?? undefined,
    );
    expect(data.adopt.mock.invocationCallOrder[0]).toBeLessThan(
      data.ensure.mock.invocationCallOrder[0],
    );
  },
);

it("preserves the local launch-directory fallback", async () => {
  data.defaultEnv = "local";
  await boot();
  expect(data.ensure).toHaveBeenCalledExactlyOnceWith("default", "C:/launch");
});

it("authorizes cold restored terminals in their own project environments", async () => {
  data.spaces = [
    {
      id: "wsl",
      name: "WSL",
      root: null,
      env: { kind: "wsl", distro: "Ubuntu" },
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "local",
      name: "Local",
      root: null,
      env: { kind: "local" },
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  await boot();
  expect(data.authorize).toHaveBeenCalledWith("/outside/home", {
    kind: "wsl",
    distro: "Ubuntu",
  });
  expect(data.authorize).toHaveBeenCalledWith("/outside/home", {
    kind: "local",
  });
});
