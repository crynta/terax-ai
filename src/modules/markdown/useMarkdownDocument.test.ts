import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type MarkdownStatus,
  useMarkdownDocument,
} from "./useMarkdownDocument";

const harness = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | undefined)[],
  refs: [] as { current: unknown }[],
  refIndex: 0,
  invoke: vi.fn(),
  listenFsChanged: vi.fn(),
  listenWritten: vi.fn(),
  watchAdd: vi.fn(),
  watchRemove: vi.fn(),
  status: { kind: "loading" } as MarkdownStatus,
}));

vi.mock("@/modules/explorer/lib/watch", () => ({
  listenFsChanged: harness.listenFsChanged,
  watchAdd: harness.watchAdd,
  watchRemove: harness.watchRemove,
  parentDir: () => "/repo",
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: harness.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: harness.listenWritten }),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    harness.effects.push(effect);
  },
  useRef: <T>(current: T) => (harness.refs[harness.refIndex++] ??= { current }),
  useState: () => [
    harness.status,
    (action: MarkdownStatus | ((prev: MarkdownStatus) => MarkdownStatus)) => {
      harness.status =
        typeof action === "function" ? action(harness.status) : action;
    },
  ],
}));

const path = "/repo/README.md";
function render(visible: boolean) {
  harness.refIndex = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: effects use the explicit test scheduler above.
  useMarkdownDocument(path, visible);
  return harness.effects.splice(0);
}

function mount() {
  const cleanups = render(true).map((effect) => effect());
  return () => {
    for (const cleanup of cleanups) cleanup?.();
  };
}

function pendingListener() {
  let resolve = (_unlisten: () => void) => {};
  const promise = new Promise<() => void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.effects = [];
  harness.refs = [];
  harness.status = { kind: "loading" };
  vi.resetAllMocks();
  harness.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === "fs_read_file" ? { kind: "text", content: "initial" } : path,
    ),
  );
});
afterEach(() => vi.useRealTimers());

it("installs both listeners before watching or reading and reloads on a change", async () => {
  const fs = pendingListener();
  const written = pendingListener();
  harness.listenFsChanged.mockReturnValue(fs.promise);
  harness.listenWritten.mockReturnValue(written.promise);
  const unmount = mount();
  fs.resolve(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.watchAdd).not.toHaveBeenCalled();
  expect(harness.invoke).not.toHaveBeenCalledWith(
    "fs_read_file",
    expect.anything(),
  );
  written.resolve(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.watchAdd).toHaveBeenCalledExactlyOnceWith(["/repo"], [path], {
    kind: "local",
  });
  expect(harness.status).toEqual({ kind: "ready", content: "initial" });

  harness.invoke.mockResolvedValueOnce({ kind: "text", content: "changed" });
  harness.listenFsChanged.mock.calls[0][0]([path]);
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.status).toEqual({ kind: "ready", content: "changed" });
  unmount();
  expect(harness.watchRemove).toHaveBeenCalledExactlyOnceWith(
    ["/repo"],
    [path],
    { kind: "local" },
  );
});

it("disposes listeners that resolve after the preview closes without registering a watch", async () => {
  const pending = pendingListener();
  const unlistenFs = vi.fn();
  const unlistenWritten = vi.fn();
  harness.listenFsChanged.mockResolvedValue(unlistenFs);
  harness.listenWritten.mockReturnValue(pending.promise);
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  unmount();
  pending.resolve(unlistenWritten);
  await vi.advanceTimersByTimeAsync(0);
  expect(unlistenFs).toHaveBeenCalledTimes(1);
  expect(unlistenWritten).toHaveBeenCalledTimes(1);
  expect(harness.watchAdd).not.toHaveBeenCalled();
  expect(harness.watchRemove).not.toHaveBeenCalled();
  expect(harness.invoke).not.toHaveBeenCalledWith(
    "fs_read_file",
    expect.anything(),
  );
});

it("still loads the document if one listener fails to register", async () => {
  harness.listenFsChanged.mockRejectedValue(new Error("listener unavailable"));
  harness.listenWritten.mockResolvedValue(vi.fn());
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.status).toEqual({ kind: "ready", content: "initial" });
  unmount();
});

it("defers an already queued reload if the preview becomes hidden", async () => {
  harness.listenFsChanged.mockResolvedValue(vi.fn());
  harness.listenWritten.mockResolvedValue(vi.fn());
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  harness.invoke.mockClear();
  harness.listenFsChanged.mock.calls[0][0]([path]);
  // Only the visibility effect changes for this rerender; path is unchanged.
  render(false)[0]();
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.invoke).not.toHaveBeenCalled();
  harness.invoke.mockResolvedValueOnce({ kind: "text", content: "changed" });
  render(true)[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).toHaveBeenCalledExactlyOnceWith("fs_read_file", {
    path,
    workspace: { kind: "local" },
  });
  expect(harness.status).toEqual({ kind: "ready", content: "changed" });
  unmount();
});
