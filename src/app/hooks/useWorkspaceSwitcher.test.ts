import type { Tab } from "@/modules/tabs/lib/tabs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  project: "a",
  values: [null, null, false] as unknown[],
  cursor: 0,
  tabs: [] as Tab[],
  home: vi.fn(async () => "/home/user"),
  authorize: vi.fn(async () => ""),
  busy: vi.fn(async () => false),
  setEnv: vi.fn(),
  reset: vi.fn(),
  alert: vi.fn(),
  confirm: vi.fn(() => false),
  toast: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState(initial: unknown) {
    const index = data.cursor++;
    if (!(index in data.values)) data.values[index] = initial;
    return [
      data.values[index],
      (value: unknown) => {
        data.values[index] = value;
      },
    ];
  },
}));
vi.mock("sonner", () => ({
  toast: { error: data.toast, dismiss: data.dismiss },
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: data.home }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { workspaceAuthorize: data.authorize },
}));
vi.mock("@/modules/workspace", () => ({
  LOCAL_WORKSPACE: { kind: "local" },
  currentWorkspaceEnv: () => ({ kind: "local" }),
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
    data.cursor = 0;
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
  data.values = [null, null, false];
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

it("clears the previous environment's directory fallbacks when home resolution fails", async () => {
  data.values = ["C:/old-home", "C:/old-launch", true];
  data.home.mockRejectedValueOnce(new Error("distro unavailable"));
  expect(await render().adoptWorkspaceEnv(env, "a")).toBeNull();
  const latest = render();
  expect(latest.home).toBeNull();
  expect(latest.launchCwd).toBeNull();
});

it("offers a guarded retry after home resolution fails", async () => {
  data.home.mockRejectedValueOnce(new Error("offline"));
  const hook = render();
  expect(await hook.adoptWorkspaceEnv(env, "a")).toBeNull();
  expect(data.toast).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ duration: Number.POSITIVE_INFINITY }),
  );
  const retry = data.toast.mock.calls[0][1].action.onClick;
  retry();
  await vi.waitFor(() => expect(data.values[0]).toBe("/home/user"));
  expect(data.home).toHaveBeenCalledTimes(2);
  expect(data.dismiss).toHaveBeenCalledWith("workspace-home");
});

it("does not retry an obsolete project's home from its old notification", async () => {
  data.home.mockRejectedValueOnce(new Error("offline"));
  await render().adoptWorkspaceEnv(env, "a");
  const retry = data.toast.mock.calls[0][1].action.onClick;
  data.project = "b";
  retry();
  expect(data.home).toHaveBeenCalledOnce();
});
