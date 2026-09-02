import { beforeEach, describe, expect, it } from "vitest";
import { useLspRuntimeStore } from "./runtimeStore";

const session = {
  key: "rust-analyzer\u0000/repo",
  presetId: "rust-analyzer",
  root: "/repo",
  status: "starting" as const,
};

describe("LSP runtime store", () => {
  beforeEach(() => {
    useLspRuntimeStore.setState({
      sessions: {},
      detected: {},
      generations: {},
      failed: {},
    });
  });

  it("upserts sessions by key and replaces on re-upsert", () => {
    const store = useLspRuntimeStore.getState();
    store.upsertSession(session);
    store.upsertSession({ ...session, status: "running" });

    expect(useLspRuntimeStore.getState().sessions[session.key].status).toBe(
      "running",
    );
  });

  it("removeSession bumps the preset generation for re-acquire", () => {
    const store = useLspRuntimeStore.getState();
    store.upsertSession(session);
    store.removeSession(session.key, session.presetId);

    expect(useLspRuntimeStore.getState().sessions[session.key]).toBeUndefined();
    expect(useLspRuntimeStore.getState().generations["rust-analyzer"]).toBe(1);
  });

  it("removeSessionQuiet tears down without a generation bump", () => {
    const store = useLspRuntimeStore.getState();
    store.upsertSession(session);
    store.removeSessionQuiet(session.key);

    expect(useLspRuntimeStore.getState().sessions[session.key]).toBeUndefined();
    expect(useLspRuntimeStore.getState().generations).toEqual({});
  });

  it("bumpGeneration accumulates per preset independently", () => {
    const store = useLspRuntimeStore.getState();
    store.bumpGeneration("rust-analyzer");
    store.bumpGeneration("rust-analyzer");
    store.bumpGeneration("pyright");

    expect(useLspRuntimeStore.getState().generations).toEqual({
      "rust-analyzer": 2,
      pyright: 1,
    });
  });

  it("setFailed records a reason and clearFailed removes only its own entry", () => {
    const store = useLspRuntimeStore.getState();
    store.setFailed("rust-analyzer", "kept crashing");
    store.setFailed("pyright", "budget kill");

    store.clearFailed("rust-analyzer");

    expect(useLspRuntimeStore.getState().failed).toEqual({
      pyright: "budget kill",
    });
  });

  it("clearFailed is a no-op for an unknown preset", () => {
    const before = useLspRuntimeStore.getState();

    before.clearFailed("gopls");

    expect(useLspRuntimeStore.getState()).toBe(before);
  });

  it("detected map stores paths and nulls, clearDetected forgets entirely", () => {
    const store = useLspRuntimeStore.getState();
    store.setDetected("rust-analyzer", "/bin/ra");
    store.setDetected("gopls", null);

    expect(useLspRuntimeStore.getState().detected).toEqual({
      "rust-analyzer": "/bin/ra",
      gopls: null,
    });

    store.clearDetected("rust-analyzer");
    expect(useLspRuntimeStore.getState().detected).toEqual({ gopls: null });
  });
});
