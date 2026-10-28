import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "@ai-sdk/react";

type Meta = { id: string; migrate: boolean; durable: boolean };

const storage = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const files = new Map<string, unknown>();
  const saves: Array<Meta & { messages: unknown }> = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const defaultInvoke = async (
    command: string,
    arg?: unknown,
    options?: { headers: Record<string, string> },
  ): Promise<unknown> => {
    if (command === "ai_session_save") {
      const meta = JSON.parse(
        options?.headers["x-terax-session"] ?? "{}",
      ) as Meta;
      const messages = JSON.parse(decoder.decode(arg as Uint8Array));
      saves.push({ ...meta, messages });
      if (!meta.migrate || !files.has(meta.id)) files.set(meta.id, messages);
      return undefined;
    }
    const { id } = (arg ?? {}) as { id: string };
    if (command === "ai_session_load") {
      return files.has(id)
        ? encoder.encode(JSON.stringify(files.get(id))).buffer
        : new ArrayBuffer(0);
    }
    if (command === "ai_session_delete") files.delete(id);
    return undefined;
  };
  const invoke = vi.fn(defaultInvoke);
  const entries = vi.fn(async () => [...data.entries()]);
  const keys = vi.fn(async () => [...data.keys()]);
  const save = vi.fn(async () => {});
  class LazyStore {
    get = vi.fn(async (key: string) => data.get(key));
    has = vi.fn(async (key: string) => data.has(key));
    set = vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    });
    delete = vi.fn(async (key: string) => {
      data.delete(key);
    });
    keys = keys;
    entries = entries;
    save = save;
  }
  return {
    data,
    files,
    saves,
    invoke,
    defaultInvoke,
    entries,
    keys,
    save,
    LazyStore,
  };
});
const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore: storage.LazyStore }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: storage.invoke }));
vi.mock("sonner", () => ({ toast: toasts }));
async function reload() {
  vi.resetModules();
  return import("@/modules/ai/lib/sessions");
}
const calls = (command: string) =>
  storage.invoke.mock.calls.filter(([name]) => name === command);

beforeEach(() => {
  storage.data.clear();
  storage.files.clear();
  storage.saves.length = 0;
  storage.invoke.mockReset();
  storage.invoke.mockImplementation(storage.defaultInvoke);
  storage.entries.mockClear();
  storage.keys.mockReset();
  storage.keys.mockImplementation(async () => [...storage.data.keys()]);
  storage.save.mockReset();
  toasts.error.mockClear();
  toasts.warning.mockClear();
  toasts.dismiss.mockClear();
});
afterEach(() => vi.useRealTimers());
const message = (id: string) =>
  [{ id, role: "user", parts: [] }] as UIMessage[];

describe("session persistence", () => {
  it("reads metadata without enumerating all conversation values", async () => {
    const mod = await reload();
    await expect(mod.loadAll()).resolves.toEqual({
      sessions: [],
      activeId: null,
    });
    const sessions = [{ id: "s-1", title: "T", createdAt: 1, updatedAt: 2 }];
    storage.data.set("sessions", sessions);
    storage.data.set("activeId", "s-1");
    storage.files.set("s-1", message("retained on disk"));
    await expect(mod.loadAll()).resolves.toEqual({ sessions, activeId: "s-1" });
    expect(storage.entries).not.toHaveBeenCalled();
    expect(calls("ai_session_save")).toHaveLength(0);
    expect(calls("ai_session_load")).toHaveLength(0);
  });

  it("migrates legacy messages durably before removing their keys and preserves a newer file on retry", async () => {
    storage.data.set("messages:s-1", message("legacy"));
    storage.data.set("messages:s-2", message("other"));
    storage.files.set("s-1", message("newer"));
    const mod = await reload();
    await mod.loadAll();
    expect(storage.files.get("s-1")).toEqual(message("newer"));
    expect(storage.files.get("s-2")).toEqual(message("other"));
    expect([...storage.data.keys()]).toEqual([]);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(storage.saves.every((s) => s.migrate && s.durable)).toBe(true);
    expect(calls("ai_session_finish_migration")).toEqual([
      ["ai_session_finish_migration", { ids: ["s-1", "s-2"] }],
    ]);
    expect(storage.entries).not.toHaveBeenCalled();
    await mod.loadAll();
    expect(calls("ai_session_save")).toHaveLength(2);
  });

  it("one failing conversation never breaks history: others migrate, loadAll resolves, the failure is reported and retried next launch", async () => {
    storage.data.set("sessions", [{ id: "s-2" }]);
    storage.data.set("messages:s-1", message("legacy"));
    storage.data.set("messages:s-2", message("fine"));
    storage.invoke.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    const mod = await reload();
    await expect(mod.loadAll()).resolves.toMatchObject({
      sessions: [{ id: "s-2" }],
    });
    expect(storage.data.has("messages:s-1")).toBe(true);
    expect(storage.data.has("messages:s-2")).toBe(false);
    expect(storage.files.get("s-2")).toEqual(message("fine"));
    expect(toasts.warning).toHaveBeenCalledOnce();
    expect(calls("ai_session_finish_migration")).toHaveLength(0);

    const next = await reload();
    await next.loadAll();
    expect(storage.files.get("s-1")).toEqual(message("legacy"));
    expect(storage.data.has("messages:s-1")).toBe(false);
    expect(calls("ai_session_finish_migration")).toHaveLength(1);
  });

  it("skips unusable legacy keys quietly and leaves them untouched", async () => {
    storage.data.set("messages:../escape", message("x"));
    storage.data.set("messages:s-1", "not an array");
    storage.data.set("messages:s-2", message("fine"));
    const mod = await reload();
    await expect(mod.loadAll()).resolves.toBeDefined();
    expect(storage.data.has("messages:../escape")).toBe(true);
    expect(storage.data.has("messages:s-1")).toBe(true);
    expect(storage.files.get("s-2")).toEqual(message("fine"));
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it("an unreadable legacy listing degrades to the metadata that is still there", async () => {
    storage.data.set("sessions", [{ id: "s-1" }]);
    storage.keys.mockRejectedValueOnce(new Error("store unavailable"));
    const mod = await reload();
    await expect(mod.loadAll()).resolves.toMatchObject({
      sessions: [{ id: "s-1" }],
    });
  });

  it("asks the native side to prune a leftover pre-migration copy when nothing is left to migrate", async () => {
    const mod = await reload();
    await mod.loadAll();
    expect(calls("ai_session_prune_backup")).toEqual([
      ["ai_session_prune_backup", { maxAgeSecs: 7 * 24 * 60 * 60 }],
    ]);
    expect(calls("ai_session_finish_migration")).toHaveLength(0);
  });

  it("writes metadata independently and flushes both metadata and message writes", async () => {
    const mod = await reload();
    const sessions = [{ id: "s-9", title: "X", createdAt: 0, updatedAt: 0 }];
    void mod.saveSessionsList(sessions);
    void mod.saveActiveId("s-9");
    void mod.saveMessages("s-9", message("saved"));
    const result = await mod.flushSessionWrites();
    expect(result).toEqual({ ok: true, timedOut: false, failed: [] });
    expect(storage.data.get("sessions")).toEqual(sessions);
    expect(storage.data.get("activeId")).toBe("s-9");
    expect(storage.files.get("s-9")).toEqual(message("saved"));
    expect(storage.data.has("messages:s-9")).toBe(false);
  });

  it("serializes saves and deletion so an older write cannot resurrect a deleted session", async () => {
    const mod = await reload();
    await mod.loadAll();
    storage.invoke.mockClear();
    let release!: () => void;
    storage.invoke.mockImplementationOnce(async (_command, arg) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      storage.files.set(
        "s-1",
        JSON.parse(new TextDecoder().decode(arg as Uint8Array)),
      );
    });
    const writing = mod.saveMessages("s-1", message("old"));
    await vi.waitFor(() => expect(storage.invoke).toHaveBeenCalledOnce());
    const deleting = mod.deleteSessionData("s-1");
    release();
    await Promise.all([writing, deleting]);
    expect(storage.files.has("s-1")).toBe(false);
    expect(storage.invoke.mock.calls.map(([command]) => command)).toEqual([
      "ai_session_save",
      "ai_session_delete",
    ]);
    await expect(mod.loadMessages("s-1")).resolves.toBeNull();
  });

  it("deleting a conversation also removes a legacy copy that was never migrated", async () => {
    storage.data.set("messages:s-1", message("legacy"));
    storage.data.set("messages:s-2", message("other"));
    const mod = await reload();
    await mod.loadAll();
    storage.data.set("messages:s-3", message("late legacy"));
    await mod.deleteSessionData("s-3");
    expect(storage.data.has("messages:s-3")).toBe(false);
    expect(calls("ai_session_delete")).toEqual([
      ["ai_session_delete", { id: "s-3" }],
    ]);
  });

  it("keeps only the newest waiting write per session while the disk is busy", async () => {
    const mod = await reload();
    await mod.loadAll();
    storage.invoke.mockClear();
    storage.saves.length = 0;
    let release!: () => void;
    storage.invoke.mockImplementationOnce(async (_command, arg, options) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      const meta = JSON.parse(
        options?.headers["x-terax-session"] ?? "{}",
      ) as Meta;
      storage.saves.push({
        ...meta,
        messages: JSON.parse(new TextDecoder().decode(arg as Uint8Array)),
      });
    });
    const first = mod.saveMessages("s-1", message("1"));
    await vi.waitFor(() => expect(storage.invoke).toHaveBeenCalledOnce());
    const rest = [2, 3, 4, 5].map((n) =>
      mod.saveMessages("s-1", message(String(n))),
    );
    release();
    await Promise.all([first, ...rest]);
    expect(storage.saves.map((s) => (s.messages as UIMessage[])[0].id)).toEqual(
      ["1", "5"],
    );
    expect(storage.files.get("s-1")).toEqual(message("5"));
  });

  it("a durable request survives being coalesced into a newer lazy save", async () => {
    const mod = await reload();
    await mod.loadAll();
    storage.saves.length = 0;
    let release!: () => void;
    storage.invoke.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const running = mod.saveMessages("s-1", message("1"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const waiting = [
      mod.saveMessages("s-1", message("2"), { durable: true }),
      mod.saveMessages("s-1", message("3")),
    ];
    release();
    await Promise.all([running, ...waiting]);
    const last = storage.saves[storage.saves.length - 1];
    expect(last?.messages).toEqual(message("3"));
    expect(last?.durable).toBe(true);
  });

  it("mid-stream saves are not durable unless asked", async () => {
    const mod = await reload();
    await mod.saveMessages("s-1", message("streaming"));
    await mod.saveMessages("s-1", message("done"), { durable: true });
    expect(storage.saves.map((s) => s.durable)).toEqual([false, true]);
  });

  it("retries a failed latest save before closing without replaying a superseded failure", async () => {
    const mod = await reload();
    await mod.loadAll();
    storage.invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(mod.saveMessages("s-1", message("retry"))).rejects.toThrow(
      "disk full",
    );
    expect(toasts.error).toHaveBeenCalledOnce();
    await expect(mod.flushSessionWrites()).resolves.toMatchObject({ ok: true });
    expect(storage.files.get("s-1")).toEqual(message("retry"));
    expect(storage.saves[storage.saves.length - 1]?.durable).toBe(true);

    storage.invoke.mockRejectedValueOnce(new Error("temporary failure"));
    const old = mod.saveMessages("s-1", message("old"));
    const latest = mod.saveMessages("s-1", message("latest"));
    await expect(old)
      .rejects.toThrow("temporary failure")
      .catch(() => {});
    await latest.catch(() => {});
    await mod.flushSessionWrites();
    expect(storage.files.get("s-1")).toEqual(message("latest"));
  });

  it("flushing never rejects and never traps close when a write keeps failing", async () => {
    const mod = await reload();
    await mod.loadAll();
    storage.invoke.mockImplementation(async (command) => {
      if (command === "ai_session_save") throw new Error("read-only volume");
      return undefined;
    });
    await expect(mod.saveMessages("s-1", message("a"))).rejects.toThrow();
    const result = await mod.flushSessionWrites({ timeoutMs: 500 });
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual(["s-1"]);
    expect(result.timedOut).toBe(false);
  });

  it("gives up waiting for a stalled disk after the timeout and reports it", async () => {
    vi.useFakeTimers();
    const mod = await reload();
    const loaded = mod.loadAll();
    await vi.runAllTimersAsync();
    await loaded;
    storage.invoke.mockImplementation(() => new Promise<unknown>(() => {}));
    void mod.saveMessages("s-1", message("a"));
    const flushing = mod.flushSessionWrites({ timeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(flushing).resolves.toMatchObject({
      ok: false,
      timedOut: true,
    });
  });

  it("a failing metadata save is reported, not thrown", async () => {
    const mod = await reload();
    storage.save.mockRejectedValueOnce(new Error("store locked"));
    await expect(mod.flushSessionWrites()).resolves.toMatchObject({
      ok: false,
    });
  });

  it("loads empty, damaged and unreadable conversations without starting an empty one by accident", async () => {
    const mod = await reload();
    await expect(mod.loadMessages("missing")).resolves.toBeNull();

    storage.invoke.mockRejectedValueOnce(
      "corrupt: conversation is not valid JSON",
    );
    await expect(mod.loadMessages("s-1")).resolves.toBeNull();
    expect(toasts.error).toHaveBeenCalledOnce();

    storage.invoke.mockRejectedValueOnce("Input/output error");
    await expect(mod.loadMessages("s-1")).rejects.toBe("Input/output error");

    storage.files.set("s-2", message("kept"));
    await expect(mod.loadMessages("s-2")).resolves.toEqual(message("kept"));
  });
});
