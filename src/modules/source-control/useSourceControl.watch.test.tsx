import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useSourceControl,
  type SourceControlSummary,
} from "./useSourceControl";

const harness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  cleanups: new Set<() => void>(),
  env: { kind: "local" } as { kind: "local" } | { kind: "wsl"; distro: string },
  snapshot: vi.fn(),
  status: vi.fn(),
  watch: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/modules/git", () => ({
  git: { panelSnapshot: harness.snapshot, status: harness.status },
}));
vi.mock("./watchSourceControl", () => ({ watchSourceControl: harness.watch }));
vi.mock("@/modules/workspace", () => ({
  useWorkspaceEnvStore: (select: (s: { env: typeof harness.env }) => unknown) =>
    select({ env: harness.env }),
  workspaceScopeKey: (env: typeof harness.env) =>
    env.kind === "local" ? "local" : `wsl:${env.distro}`,
}));
vi.mock("react", async (original) => {
  function slot<T>(initial: () => T): T {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = initial();
    return harness.slots[index] as T;
  }
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[]) =>
    a?.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function memo<T>(create: () => T, deps: readonly unknown[]): T {
    const cell = slot<{ deps?: readonly unknown[]; value?: T }>(() => ({}));
    if (!same(cell.deps, deps)) {
      cell.value = create();
      cell.deps = deps;
    }
    return cell.value as T;
  }
  return {
    ...(await original<typeof import("react")>()),
    useState: <T,>(initial: T) => {
      const cell = slot(() => ({ value: initial }));
      return [
        cell.value,
        (action: T | ((value: T) => T)) => {
          cell.value =
            typeof action === "function"
              ? (action as (value: T) => T)(cell.value)
              : action;
        },
      ];
    },
    useRef: <T,>(initial: T) => slot(() => ({ current: initial })),
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: readonly unknown[]) =>
      memo(() => callback, deps),
    useEffectEvent: <T,>(callback: () => T) => {
      const cell = slot(() => ({ callback, call: () => cell.callback() }));
      cell.callback = callback;
      return cell.call;
    },
    useEffect: (
      effect: () => undefined | (() => void),
      deps: readonly unknown[],
    ) => {
      const cell = slot<{ deps?: readonly unknown[]; cleanup?: () => void }>(
        () => ({}),
      );
      if (same(cell.deps, deps)) return;
      cell.deps = deps;
      harness.effects.push(() => {
        if (cell.cleanup) {
          cell.cleanup();
          harness.cleanups.delete(cell.cleanup);
        }
        cell.cleanup = effect() || undefined;
        if (cell.cleanup) harness.cleanups.add(cell.cleanup);
      });
    },
  };
});

type Props = { path: string; enabled?: boolean; live?: boolean };
let summary: SourceControlSummary;
function Probe({ path, enabled = true, live = true }: Props) {
  summary = useSourceControl(path, enabled, { live });
  return null;
}
function render(props: Props) {
  harness.cursor = 0;
  renderToStaticMarkup(createElement(Probe, props));
  for (const effect of harness.effects.splice(0)) effect();
}
async function settle(props: Props) {
  await vi.advanceTimersByTimeAsync(0);
  render(props);
}

const repo = {
  repoRoot: "/real/repo",
  branch: "main",
  upstream: null,
  isDetached: false,
};
const status = { ...repo, changedFiles: [], ahead: 0, behind: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  harness.cursor = 0;
  harness.slots = [];
  harness.effects = [];
  harness.cleanups.clear();
  harness.env = { kind: "local" };
  harness.snapshot.mockResolvedValue({ repo, status });
  harness.status.mockResolvedValue(status);
  harness.watch.mockReturnValue(harness.release);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
  );
});
afterEach(() => {
  for (const cleanup of harness.cleanups) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps a symlink-resolved repository watched through its status refresh", async () => {
  const props = { path: "/work/link/src" };
  render(props);
  await settle(props);
  expect(harness.watch).toHaveBeenCalledTimes(1);
  expect(harness.watch.mock.calls[0][0]).toBe("/real/repo");
  const refresh = harness.watch.mock.calls[0][1] as () => Promise<void>;
  let finish!: (value: typeof status) => void;
  harness.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = refresh();
  render(props);
  expect(summary.repo).toEqual(repo);
  expect(harness.release).not.toHaveBeenCalled();
  finish(status);
  await pending;
  render(props);
  expect(harness.status).toHaveBeenCalledWith("/real/repo");
  expect(summary.repo).toEqual(repo);
  expect(harness.watch).toHaveBeenCalledTimes(1);
  expect(harness.release).not.toHaveBeenCalled();
});

it("retains a watch across same-repository cd and releases it for another repository", async () => {
  render({ path: "/real/repo/a" });
  await settle({ path: "/real/repo/a" });
  render({ path: "/real/repo/b" });
  await settle({ path: "/real/repo/b" });
  expect(harness.watch).toHaveBeenCalledTimes(1);
  expect(harness.release).not.toHaveBeenCalled();
  const refresh = harness.watch.mock.calls[0][1] as () => Promise<void>;
  await refresh();
  expect(harness.status).toHaveBeenCalledExactlyOnceWith("/real/repo");
  harness.snapshot.mockResolvedValue({
    repo: { ...repo, repoRoot: "/other" },
    status,
  });
  render({ path: "/other" });
  await settle({ path: "/other" });
  expect(harness.release).toHaveBeenCalledTimes(1);
  expect(harness.watch.mock.calls.map(([root]) => root)).toEqual([
    "/real/repo",
    "/other",
  ]);
  for (const cleanup of harness.cleanups) cleanup();
  harness.cleanups.clear();
  expect(harness.release).toHaveBeenCalledTimes(2);
});

it("holds no watch without a live enabled consumer and releases on hide", async () => {
  render({ path: "/real/repo", live: false });
  await settle({ path: "/real/repo", live: false });
  expect(harness.watch).not.toHaveBeenCalled();
  render({ path: "/real/repo", live: true });
  await settle({ path: "/real/repo", live: true });
  expect(harness.watch).toHaveBeenCalledTimes(1);
  render({ path: "/real/repo", live: false });
  expect(harness.release).toHaveBeenCalledTimes(1);
  render({ path: "/real/repo", enabled: false });
  expect(harness.watch).toHaveBeenCalledTimes(1);
});

it.each(["local", "wsl"] as const)(
  "keeps focus fallback in %s workspaces",
  async (kind) => {
    harness.env = kind === "local" ? { kind } : { kind, distro: "Ubuntu" };
    const props = { path: "/real/repo" };
    render(props);
    await settle(props);
    expect(harness.watch).toHaveBeenCalledTimes(kind === "local" ? 1 : 0);
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(400);
    expect(harness.status).toHaveBeenCalledTimes(1);
  },
);
