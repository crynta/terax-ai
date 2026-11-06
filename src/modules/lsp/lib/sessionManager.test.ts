import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  close: vi.fn(),
  shutdown: vi.fn(),
  prefs: { lspActivation: { test: "enabled" }, lspCustomServers: [] },
  subscribe: vi.fn(),
  hostPid: vi.fn(),
  exits: [] as (() => void)[],
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => mocks.prefs,
    subscribe: mocks.subscribe,
  },
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { path: string }) =>
    command === "lsp_resolve_root"
      ? args.path.split("/file")[0]
      : mocks.hostPid(),
}));
vi.mock("./detect", () => ({ detectBinary: async () => "/bin/test" }));
vi.mock("./presets", () => ({
  serverForLanguage: () => ({
    id: "test",
    name: "Test",
    command: "test",
    args: [],
    rootMarkers: [".git"],
    languages: { ts: "typescript" },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./transport", () => ({
  TauriLspTransport: class {
    exitInfo = null;
    start = mocks.start;
    stop = mocks.close;
  },
}));
vi.mock("./client", () => ({
  TeraxLspClient: class {
    static hostPid = 1;
    constructor(config: { onClose: () => void }) {
      mocks.exits.push(config.onClose);
    }
    close = vi.fn();
    initializePromise = Promise.resolve();
    shutdownGracefully = mocks.shutdown;
    textDocumentDidClose = vi.fn();
  },
  lspInteractions: () => [],
  languageServerWithTransport: () => [],
  SynchronizationMethod: { Incremental: 2 },
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Dynamic imports must finish before asserting how many starts were admitted.
async function settle() {
  for (let i = 0; i < 10; i++) await tick();
}

describe("LSP session capacity", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.exits = [];
    mocks.prefs.lspActivation = { test: "enabled" };
    mocks.hostPid.mockResolvedValue(1);
    (await import("./client")).TeraxLspClient.hostPid = 1;
    mocks.start.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.shutdown.mockResolvedValue(undefined);
    await import("./transport");
  });

  it("reserves four slots before deferred starts and shares same-root starts", async () => {
    const gate = deferred();
    mocks.start.mockReturnValue(gate.promise);
    const { acquireDocExtension } = await import("./sessionManager");
    const requests = [];
    for (let i = 0; i < 8; i++) {
      requests.push(acquireDocExtension(`/root${i}/file.ts`, "ts"));
      await settle();
    }
    const same = acquireDocExtension("/root0/file2.ts", "ts");
    await settle();
    expect(mocks.start).toHaveBeenCalledTimes(4);
    gate.resolve();
    expect((await Promise.all(requests)).filter(Boolean)).toHaveLength(4);
    expect(await same).not.toBeNull();
    expect(mocks.start).toHaveBeenCalledTimes(4);
  });

  it("reacquires after disable and re-enable during host lookup", async () => {
    const host = deferred();
    (await import("./client")).TeraxLspClient.hostPid = null;
    mocks.hostPid.mockReturnValue(host.promise);
    const { acquireDocExtension } = await import("./sessionManager");
    const { useLspRuntimeStore } = await import("./runtimeStore");
    const request = acquireDocExtension("/root/file.ts", "ts");
    await settle();
    const prev = { ...mocks.prefs };
    mocks.prefs.lspActivation = { test: "dismissed" };
    mocks.subscribe.mock.calls[0][0](mocks.prefs, prev);
    const disabled = { ...mocks.prefs };
    mocks.prefs.lspActivation = { test: "enabled" };
    mocks.subscribe.mock.calls[0][0](mocks.prefs, disabled);
    expect(await acquireDocExtension("/root/file.ts", "ts")).toBeNull();
    const before = useLspRuntimeStore.getState().generations.test ?? 0;
    host.resolve();
    expect(await request).toBeNull();
    await settle();
    expect(useLspRuntimeStore.getState().generations.test).toBeGreaterThan(
      before,
    );
    expect(await acquireDocExtension("/root/file.ts", "ts")).not.toBeNull();
  });

  it("releases a failed shutdown reservation when exit is later confirmed", async () => {
    const { acquireDocExtension, restartPresetSessions } = await import(
      "./sessionManager"
    );
    await acquireDocExtension("/root/file.ts", "ts");
    mocks.close.mockRejectedValueOnce(new Error("kill failed"));
    await expect(restartPresetSessions("test")).rejects.toThrow("kill failed");
    expect(await acquireDocExtension("/root/file.ts", "ts")).toBeNull();
    mocks.exits[0]();
    expect(await acquireDocExtension("/root/file.ts", "ts")).not.toBeNull();
    mocks.exits[0]();
    expect(await acquireDocExtension("/root/file2.ts", "ts")).not.toBeNull();
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("frees a failed startup reservation", async () => {
    const gate = deferred();
    mocks.start.mockReturnValueOnce(gate.promise);
    const { acquireDocExtension } = await import("./sessionManager");
    const failed = acquireDocExtension("/bad/file.ts", "ts");
    await settle();
    gate.reject(new Error("cannot start"));
    expect(await failed).toBeNull();
    const handles = [];
    for (let i = 0; i < 4; i++)
      handles.push(await acquireDocExtension(`/root${i}/file.ts`, "ts"));
    expect(handles.filter(Boolean)).toHaveLength(4);
  });

  it("holds capacity until shutdown and native kill finish", async () => {
    const { acquireDocExtension, restartPresetSessions } = await import(
      "./sessionManager"
    );
    for (let i = 0; i < 4; i++)
      await acquireDocExtension(`/root${i}/file.ts`, "ts");
    const shutdown = deferred();
    const kill = deferred();
    mocks.shutdown.mockReturnValue(shutdown.promise);
    mocks.close.mockReturnValue(kill.promise);
    let stopped = false;
    const restart = restartPresetSessions("test").then(() => {
      stopped = true;
    });
    expect(await acquireDocExtension("/new/file.ts", "ts")).toBeNull();
    shutdown.resolve();
    await settle();
    expect(stopped).toBe(false);
    expect(await acquireDocExtension("/new/file.ts", "ts")).toBeNull();
    kill.resolve();
    await restart;
    expect(await acquireDocExtension("/new/file.ts", "ts")).not.toBeNull();
  });

  it.each(["restart", "disable"])(
    "cancels deferred starts during %s",
    async (action) => {
      const gate = deferred();
      mocks.start.mockReturnValue(gate.promise);
      const { acquireDocExtension, restartPresetSessions } = await import(
        "./sessionManager"
      );
      const request = acquireDocExtension("/root/file.ts", "ts");
      await settle();
      let restart: Promise<void> | undefined;
      if (action === "restart") restart = restartPresetSessions("test");
      else {
        const prev = { ...mocks.prefs };
        mocks.prefs.lspActivation = { test: "dismissed" };
        mocks.subscribe.mock.calls[0][0](mocks.prefs, prev);
      }
      gate.resolve();
      expect(await request).toBeNull();
      await restart;
      await settle();
      expect(mocks.close).toHaveBeenCalledTimes(1);
    },
  );
});
