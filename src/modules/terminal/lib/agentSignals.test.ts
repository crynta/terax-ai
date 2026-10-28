import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
const native = vi.hoisted(() => ({
  listen: vi.fn(),
  emit: undefined as Handler | undefined,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: native.listen,
}));

async function load() {
  vi.resetModules();
  return import("./agentActivity");
}

beforeEach(() => {
  native.listen.mockReset();
  native.listen.mockImplementation(async (_event: string, cb: Handler) => {
    native.emit = cb;
    return () => undefined;
  });
});

describe("agent signal fan-out", () => {
  it("serves the store and every subscriber from one native listener", async () => {
    const mod = await load();
    const a = vi.fn();
    const b = vi.fn();
    mod.subscribeAgentSignals(a);
    mod.subscribeAgentSignals(b);
    await mod.ensureAgentActivityListener();

    expect(native.listen).toHaveBeenCalledTimes(1);
    expect(native.listen).toHaveBeenCalledWith(
      "terax:agent-signal",
      expect.any(Function),
    );

    native.emit?.({ payload: { id: 7, kind: "working", agent: "claude" } });
    expect(mod.useAgentActivityStore.getState().phases[7]).toBe("working");
    expect(a).toHaveBeenCalledWith({ id: 7, kind: "working", agent: "claude" });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("runs subscribers after the store has applied the signal", async () => {
    const mod = await load();
    let seen: string | undefined;
    mod.subscribeAgentSignals((signal) => {
      seen = mod.useAgentActivityStore.getState().phases[signal.id];
    });
    await mod.ensureAgentActivityListener();
    native.emit?.({ payload: { id: 3, kind: "attention" } });
    expect(seen).toBe("attention");
  });

  it("stops delivering after unsubscribe and survives a throwing handler", async () => {
    const mod = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const good = vi.fn();
    const off = mod.subscribeAgentSignals(good);
    mod.subscribeAgentSignals(() => {
      throw new Error("boom");
    });
    await mod.ensureAgentActivityListener();

    native.emit?.({ payload: { id: 1, kind: "started", agent: "codex" } });
    expect(good).toHaveBeenCalledTimes(1);
    expect(mod.useAgentActivityStore.getState().agents[1]).toBe("codex");

    off();
    native.emit?.({ payload: { id: 1, kind: "finished" } });
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
