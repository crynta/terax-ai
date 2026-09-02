import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

type FakeRoot = {
  attrs: Map<string, string>;
  style: { backgroundColor: string };
};

function fakeDocument(): FakeRoot {
  const attrs = new Map<string, string>();
  const root = {
    attrs,
    style: { backgroundColor: "" },
    setAttribute(k: string, v: string) {
      attrs.set(k, v);
    },
    removeAttribute(k: string) {
      attrs.delete(k);
    },
    hasAttribute(k: string) {
      return attrs.has(k);
    },
  };
  vi.stubGlobal("document", { documentElement: root });
  return root as unknown as FakeRoot;
}

async function loadModule() {
  return await import("./vibrancy");
}

describe("vibrancy application", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    core.invoke.mockReset();
  });

  it("caches the backdrop kind in a single backend probe", async () => {
    fakeDocument();
    core.invoke.mockResolvedValue("mica");
    const vibrancy = await loadModule();

    await vibrancy.getBackdropKind();
    await vibrancy.getBackdropKind();

    expect(core.invoke).toHaveBeenCalledTimes(1);
    expect(core.invoke).toHaveBeenCalledWith("window_backdrop_kind");
  });

  it("falls back to none when the backend probe fails", async () => {
    fakeDocument();
    core.invoke.mockRejectedValue(new Error("unsupported"));
    const vibrancy = await loadModule();

    await expect(vibrancy.getBackdropKind()).resolves.toBe("none");
  });

  it("turns the effect on and repaints the transparent surface", async () => {
    const root = fakeDocument();
    root.style.backgroundColor = "#141414";
    core.invoke.mockResolvedValue("vibrancy");
    const vibrancy = await loadModule();

    await vibrancy.applyVibrancy(true, true);

    expect(root.attrs.get("data-vibrancy")).toBe("on");
    expect(root.style.backgroundColor).toBe("");
    expect(core.invoke).toHaveBeenCalledWith("window_set_backdrop", {
      enabled: true,
      dark: true,
    });
  });

  it("skips the native call when the state was already applied", async () => {
    fakeDocument();
    core.invoke.mockResolvedValue("vibrancy");
    const vibrancy = await loadModule();

    await vibrancy.applyVibrancy(true, true);
    await vibrancy.applyVibrancy(true, true);

    expect(core.invoke).toHaveBeenCalledTimes(2);
  });

  it("rebuilds mica on a dark-mode flip", async () => {
    fakeDocument();
    core.invoke.mockResolvedValue("mica");
    const vibrancy = await loadModule();

    await vibrancy.applyVibrancy(true, true);
    await vibrancy.applyVibrancy(true, false);

    const backdrop = core.invoke.mock.calls.filter(
      (c) => c[0] === "window_set_backdrop",
    );
    expect(backdrop).toHaveLength(2);
    expect(backdrop[1][1]).toEqual({ enabled: true, dark: false });
  });

  it("keeps an existing NSVisualEffectView across a dark-mode flip", async () => {
    fakeDocument();
    core.invoke.mockResolvedValue("vibrancy");
    const vibrancy = await loadModule();

    await vibrancy.applyVibrancy(true, true);
    await vibrancy.applyVibrancy(true, false);

    const backdrop = core.invoke.mock.calls.filter(
      (c) => c[0] === "window_set_backdrop",
    );
    expect(backdrop).toHaveLength(1);
  });

  it("paints opaque and disables natively when the platform reports none", async () => {
    const root = fakeDocument();
    root.style.backgroundColor = "";
    core.invoke.mockResolvedValue("none");
    const vibrancy = await loadModule();

    await vibrancy.applyVibrancy(true, true);

    expect(root.attrs.has("data-vibrancy")).toBe(false);
    expect(root.style.backgroundColor).toBe("#141414");
    const backdrop = core.invoke.mock.calls.filter(
      (c) => c[0] === "window_set_backdrop",
    );
    expect(backdrop).toEqual([["window_set_backdrop", { enabled: false, dark: true }]]);
  });

  it("repaints opaque when the native side fails so the webview is never see-through", async () => {
    const root = fakeDocument();
    core.invoke.mockResolvedValue("vibrancy");
    const vibrancy = await loadModule();

    core.invoke.mockImplementation((cmd: string) =>
      cmd === "window_backdrop_kind"
        ? Promise.resolve("vibrancy")
        : Promise.reject(new Error("boom")),
    );
    await vibrancy.applyVibrancy(true, true);

    expect(root.attrs.has("data-vibrancy")).toBe(false);
    expect(root.style.backgroundColor).toBe("#141414");

    core.invoke.mockImplementation(() => Promise.resolve());
    await vibrancy.applyVibrancy(true, true);

    expect(root.attrs.get("data-vibrancy")).toBe("on");
  });

  it("repaints the light pre-paint color when disabling in light mode", async () => {
    const root = fakeDocument();
    core.invoke.mockResolvedValue("vibrancy");
    const vibrancy = await loadModule();

    await vibrancy.applyVibrancy(false, false);

    expect(root.style.backgroundColor).toBe("#ffffff");
    expect(core.invoke).toHaveBeenCalledWith("window_set_backdrop", {
      enabled: false,
      dark: false,
    });
  });

  it("serializes concurrent toggles so they cannot land out of order", async () => {
    fakeDocument();
    const vibrancy = await loadModule();
    let releaseFirst: (() => void) | undefined;
    core.invoke.mockImplementation((cmd: string) => {
      if (cmd === "window_backdrop_kind") return Promise.resolve("vibrancy");
      if (core.invoke.mock.calls.filter((c) => c[0] === "window_set_backdrop").length === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve();
    });

    const first = vibrancy.applyVibrancy(true, true);
    const second = vibrancy.applyVibrancy(false, true);

    const backdropCalls = () =>
      core.invoke.mock.calls.filter((c) => c[0] === "window_set_backdrop").length;
    await new Promise((r) => setTimeout(r, 0));
    expect(backdropCalls()).toBe(1);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(backdropCalls()).toBe(2);
  });
});
