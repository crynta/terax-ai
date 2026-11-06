import type { WorkspaceEnv } from "@/modules/workspace";
import { beforeEach, expect, it, vi } from "vitest";
import type { FileHit } from "../lib/quickOpen";
import { useFileSearch } from "./useFileSearch";

const harness = vi.hoisted(() => ({
  workspace: { kind: "local" } as WorkspaceEnv,
  state: null as unknown,
  requestId: { current: 0 },
  effects: [] as (() => (() => void) | undefined)[],
  cleanups: [] as (() => void)[],
  requests: [] as { args: unknown; resolve: (value: unknown) => void }[],
}));

vi.mock("@/modules/workspace", () => ({
  useWorkspaceEnvStore: (select: (state: { env: WorkspaceEnv }) => unknown) =>
    select({ env: harness.workspace }),
  workspaceScopeKey: (env: WorkspaceEnv) =>
    env.kind === "wsl" ? `wsl:${env.distro}` : "local",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) =>
    command === "fs_search"
      ? new Promise((resolve) => harness.requests.push({ args, resolve }))
      : Promise.resolve(),
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => (() => void) | undefined) => {
    harness.effects.push(effect);
  },
  useRef: () => harness.requestId,
  useState: <T>() => [
    harness.state,
    (action: T | ((prev: T) => T)) => {
      harness.state =
        typeof action === "function"
          ? (action as (prev: T) => T)(harness.state as T)
          : action;
    },
  ],
}));

function render(root: string, query = "file", showHidden = false) {
  harness.effects = [];
  // biome-ignore lint/correctness/useHookAtTopLevel: effects and state use the explicit test scheduler above.
  return useFileSearch(root, query, true, showHidden);
}

function commit() {
  for (const cleanup of harness.cleanups.splice(0)) cleanup();
  for (const effect of harness.effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  }
}

async function reply(index: number, path: string) {
  const hit = { path } satisfies Pick<FileHit, "path">;
  harness.requests[index].resolve({ hits: [hit], cancelled: false });
  await Promise.resolve();
}

beforeEach(() => {
  harness.workspace = { kind: "local" };
  harness.state = null;
  harness.requestId.current = 0;
  harness.requests = [];
  harness.effects = [];
  harness.cleanups = [];
});

it("retains hits while typing but never exposes the previous root's results", async () => {
  render("/old");
  commit();
  await reply(0, "/old/file");
  expect(render("/old", "file2").hits).toMatchObject([{ path: "/old/file" }]);
  commit();
  expect(render("/new", "file2")).toMatchObject({ hits: [], loading: true });
  commit();
  await reply(2, "/new/file2");
  await reply(1, "/old/file2");
  expect(render("/new", "file2").hits).toMatchObject([{ path: "/new/file2" }]);
});

it("invalidates results when the environment or hidden-file filter changes", async () => {
  render("/repo", "file", true);
  commit();
  await reply(0, "/repo/.file");
  expect(render("/repo", "file", false).hits).toEqual([]);
  commit();
  await reply(1, "/repo/file");
  harness.workspace = { kind: "wsl", distro: "Ubuntu" };
  expect(render("/repo", "file", false).hits).toEqual([]);
  commit();
  expect(harness.requests[2].args).toMatchObject({
    root: "/repo",
    workspace: harness.workspace,
    showHidden: false,
  });
});
