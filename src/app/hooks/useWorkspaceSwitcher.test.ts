import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs/lib/tabs";

const data = vi.hoisted(() => ({
  project: "a",
  tabs: [] as Tab[],
  home: vi.fn(async () => "/home/user"),
  authorize: vi.fn(async () => ""),
  busy: vi.fn(async () => false),
  setEnv: vi.fn(),
  reset: vi.fn(),
  alert: vi.fn(),
  confirm: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: data.home }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { workspaceAuthorize: data.authorize },
}));
vi.mock("@/modules/workspace", () => ({
  LOCAL_WORKSPACE: { kind: "local" },
  getWslHome: data.home,
}));
vi.mock("@/modules/terminal", () => ({ leafHasForegroundProcess: data.busy }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ confirmCloseRunningTerminal: true }),
  },
}));
vi.mock("@/modules/spaces/lib/useSpaces", () => ({
  useSpaces: { getState: () => ({ activeId: data.project, spaces: [] }) },
}));
vi.mock("@/modules/workbench/store", () => ({
  snapshot: () => ({ activeProjectId: data.project, tabs: data.tabs }),
}));
import { useWorkspaceSwitcher } from "./useWorkspaceSwitcher";

function render() {
  let hook!: ReturnType<typeof useWorkspaceSwitcher>;
  function Probe() {
    hook = useWorkspaceSwitcher({
      workspaceEnv: { kind: "local" },
      setWorkspaceEnv: data.setEnv,
      resetWorkspace: data.reset,
    });
    return null;
  }
  renderToString(createElement(Probe));
  return hook;
}
afterEach(() => vi.unstubAllGlobals());

const env = { kind: "wsl", distro: "Ubuntu" } as const;
const dirty = (spaceId: string): Tab => ({
  id: 2,
  kind: "editor",
  spaceId,
  path: "/file",
  title: "file",
  dirty: true,
  preview: false,
});
beforeEach(() => {
  vi.clearAllMocks();
  data.project = "a";
  data.tabs = [{ id: 1, kind: "terminal", spaceId: "a", title: "shell" }];
  data.home.mockResolvedValue("/home/user");
  data.authorize.mockResolvedValue("");
  data.busy.mockResolvedValue(false);
  vi.stubGlobal("window", { alert: data.alert, confirm: data.confirm });
});

it.each(["home", "authorize"] as const)(
  "cancels a switch when the project changes during %s",
  async (stage) => {
    let release!: (value: string) => void;
    data[stage].mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = render().switchWorkspace("a", env);
    await vi.waitFor(() => expect(release).toBeDefined());
    data.project = "b";
    release("/home/user");
    expect(await pending).toBe(false);
    expect(data.reset).not.toHaveBeenCalled();
    expect(data.setEnv).not.toHaveBeenCalled();
  },
);

it("ignores another project's dirty editor and resets only the originating project", async () => {
  data.tabs.push(dirty("b"));
  expect(await render().switchWorkspace("a", env)).toBe(true);
  expect(data.authorize).toHaveBeenCalledWith("/home/user", env);
  expect(data.reset).toHaveBeenCalledExactlyOnceWith("a", "/home/user", env);
});

it("rechecks edits made during authorization before resetting", async () => {
  data.authorize.mockImplementationOnce(async () => {
    data.tabs.push(dirty("a"));
    return "";
  });
  expect(await render().switchWorkspace("a", env)).toBe(false);
  expect(data.alert).toHaveBeenCalledOnce();
  expect(data.reset).not.toHaveBeenCalled();
  expect(data.setEnv).not.toHaveBeenCalled();
});

it("checks foreground processes before reset and preserves state on cancellation", async () => {
  data.busy.mockResolvedValue(true);
  expect(await render().switchWorkspace("a", env)).toBe(false);
  expect(data.confirm).toHaveBeenCalledOnce();
  expect(data.reset).not.toHaveBeenCalled();
  expect(data.setEnv).not.toHaveBeenCalled();
});

it("does not let a stale adoption replace the newest environment", async () => {
  let release!: (value: string) => void;
  data.home.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const hook = render();
  const first = hook.adoptWorkspaceEnv(env, "a");
  data.project = "b";
  const next = { kind: "wsl", distro: "Debian" } as const;
  await hook.adoptWorkspaceEnv(next, "b");
  release("/old/home");
  expect(await first).toBeNull();
  expect(data.setEnv).toHaveBeenLastCalledWith(next);
  expect(data.setEnv).toHaveBeenCalledTimes(2);
});
