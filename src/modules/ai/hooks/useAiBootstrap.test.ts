import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  cleanups: new Set<() => void>(),
  prefs: {
    hydrated: false,
    customEndpoints: [] as { id: string; baseURL: string; modelId: string }[],
  },
  getAllKeys: vi.fn(),
  getEndpointKeys: vi.fn(),
  onKeysChanged: vi.fn(),
  unlisten: vi.fn(),
  setApiKeys: vi.fn(),
  setEndpointKeys: vi.fn(),
  setSelectedModel: vi.fn(),
  hydrateSessions: vi.fn(),
  initPrefs: vi.fn(),
}));
vi.mock("react", () => {
  function slot<T>(initial: () => T): T {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = initial();
    return harness.slots[index] as T;
  }
  return {
    useState: <T>(initial: T) => {
      const cell = slot(() => ({ value: initial }));
      return [
        cell.value,
        (value: T) => {
          cell.value = value;
        },
      ];
    },
    useEffect: (
      effect: () => void | (() => void),
      deps: readonly unknown[],
    ) => {
      const cell = slot<{ deps?: readonly unknown[]; cleanup?: () => void }>(
        () => ({}),
      );
      if (
        cell.deps?.length === deps.length &&
        cell.deps.every((value, i) => Object.is(value, deps[i]))
      )
        return;
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
vi.mock("@/modules/settings/preferences", () => {
  const prefs = new Proxy(harness.prefs, {
    get: (target, key) =>
      key === "init" ? harness.initPrefs : (Reflect.get(target, key) ?? ""),
  });
  return {
    usePreferencesStore: Object.assign(
      (select: (state: unknown) => unknown) => select(prefs),
      { getState: () => prefs },
    ),
  };
});
vi.mock("@/modules/settings/store", () => ({
  onKeysChanged: harness.onKeysChanged,
}));
vi.mock("../lib/keyring", () => ({
  getAllKeys: harness.getAllKeys,
  getAllCustomEndpointKeys: harness.getEndpointKeys,
  hasAnyKey: () => false,
}));
vi.mock("../store/chatStore", () => ({
  useChatStore: (select: (state: unknown) => unknown) =>
    select({
      apiKeys: {},
      setApiKeys: harness.setApiKeys,
      setCustomEndpointKeys: harness.setEndpointKeys,
      setSelectedModelId: harness.setSelectedModel,
      activeSessionId: null,
      hydrateSessions: harness.hydrateSessions,
    }),
}));
vi.mock("../store/agentsStore", () => ({
  useAgentsStore: { getState: () => ({ hydrate: vi.fn() }) },
}));
vi.mock("../store/snippetsStore", () => ({
  useSnippetsStore: { getState: () => ({ hydrate: vi.fn() }) },
}));
vi.mock("@/modules/agents/lib/review", () => ({
  firePendingReviewForSession: vi.fn(),
}));

import { useAiBootstrap } from "./useAiBootstrap";

function render() {
  harness.cursor = 0;
  const useBootstrap = useAiBootstrap;
  const result = useBootstrap();
  for (const effect of harness.effects.splice(0)) effect();
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  harness.cursor = 0;
  harness.slots = [];
  harness.effects = [];
  harness.cleanups.clear();
  harness.prefs.hydrated = false;
  harness.prefs.customEndpoints = [];
  harness.hydrateSessions.mockResolvedValue(undefined);
  harness.getAllKeys.mockResolvedValue({ provider: "key" });
  harness.getEndpointKeys.mockResolvedValue({ custom: "key" });
  harness.onKeysChanged.mockResolvedValue(harness.unlisten);
});
afterEach(() => {
  for (const cleanup of harness.cleanups) cleanup();
});

it("loads one provider batch across cold preference hydration and refreshes on key changes", async () => {
  expect(render().keysLoaded).toBe(false);
  harness.prefs.hydrated = true;
  render();
  await Promise.resolve();
  expect(render().keysLoaded).toBe(true);
  expect(harness.getAllKeys).toHaveBeenCalledTimes(1);
  expect(harness.getEndpointKeys).toHaveBeenCalledTimes(1);
  expect(harness.onKeysChanged).toHaveBeenCalledTimes(1);
  harness.prefs.customEndpoints = [
    { id: "new", baseURL: "http://localhost", modelId: "model" },
  ];
  harness.onKeysChanged.mock.calls[0][0]();
  await Promise.resolve();
  expect(harness.getAllKeys).toHaveBeenCalledTimes(2);
  expect(harness.getEndpointKeys).toHaveBeenLastCalledWith(
    harness.prefs.customEndpoints,
  );
  expect(harness.setApiKeys).toHaveBeenCalledTimes(2);
});

it("ignores in-flight results after unmount and releases the listener", async () => {
  harness.prefs.hydrated = true;
  let finishProvider!: (keys: object) => void;
  let finishEndpoint!: (keys: object) => void;
  harness.getAllKeys.mockReturnValue(
    new Promise((resolve) => {
      finishProvider = resolve;
    }),
  );
  harness.getEndpointKeys.mockReturnValue(
    new Promise((resolve) => {
      finishEndpoint = resolve;
    }),
  );
  render();
  for (const cleanup of harness.cleanups) cleanup();
  harness.cleanups.clear();
  finishProvider({ provider: "late" });
  finishEndpoint({ custom: "late" });
  await Promise.resolve();
  expect(harness.setApiKeys).not.toHaveBeenCalled();
  expect(harness.setEndpointKeys).not.toHaveBeenCalled();
  expect(harness.unlisten).toHaveBeenCalledTimes(1);
});

it("loads and refreshes provider keys even when preference initialization fails", async () => {
  const failed = Promise.reject(new Error("preference storage unavailable"));
  await failed.catch(() => {});
  harness.initPrefs.mockReturnValue(failed);
  render();
  await Promise.resolve();
  expect(render().keysLoaded).toBe(true);
  expect(harness.setApiKeys).toHaveBeenCalledWith({ provider: "key" });
  expect(harness.getEndpointKeys).not.toHaveBeenCalled();
  harness.onKeysChanged.mock.calls[0][0]();
  await Promise.resolve();
  expect(harness.getAllKeys).toHaveBeenCalledTimes(2);
});
