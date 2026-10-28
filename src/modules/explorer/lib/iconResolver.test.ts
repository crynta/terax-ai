import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeEngine = {
  fileIconUrl: (name: string) => `file:${name}`,
  folderIconUrl: (name: string, open: boolean) => `folder:${name}:${open}`,
};
const loads = vi.hoisted(() => ({ count: 0, fail: 0 }));

type Resolver = typeof import("./iconResolver");

// `doMock` (not `mock`) so every test gets a fresh factory: the factory body
// runs exactly when the shell's dynamic `import("./iconEngine")` fires, which
// is what these tests count.
async function load(): Promise<Resolver> {
  vi.resetModules();
  loads.count = 0;
  vi.doMock("./iconEngine", () => {
    loads.count++;
    if (loads.fail > 0) {
      loads.fail--;
      throw new Error("chunk failed");
    }
    return { iconEngine: fakeEngine };
  });
  return import("./iconResolver");
}

beforeEach(() => {
  loads.fail = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("iconResolver (lazy shell)", () => {
  it("costs nothing until something asks: no engine import on module load", async () => {
    const r = await load();
    expect(loads.count).toBe(0);
    expect(r.peekFileIconUrl("a.ts")).toBe("");
    expect(r.peekFolderIconUrl("src", false)).toBe("");
    expect(loads.count).toBe(0);
  });

  it("subscribing requests the engine once, shares the load, and notifies after it lands", async () => {
    const r = await load();
    const a = vi.fn();
    const b = vi.fn();
    r.subscribeFileIcons(a);
    r.subscribeFileIcons(b);
    expect(r.peekFileIconUrl("x.ts")).toBe("");

    await r.preloadFileIcons();

    expect(loads.count).toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(r.peekFileIconUrl("x.ts")).toBe("file:x.ts");
    expect(r.peekFolderIconUrl("src", true)).toBe("folder:src:true");
  });

  it("does not keep listener slots for subscribers that arrive after the load", async () => {
    const r = await load();
    await r.preloadFileIcons();
    const late = vi.fn();
    const unsubscribe = r.subscribeFileIcons(late);
    unsubscribe();
    expect(late).not.toHaveBeenCalled();
    expect(loads.count).toBe(1);
  });

  it("stops notifying an unsubscribed listener", async () => {
    const r = await load();
    const gone = vi.fn();
    const kept = vi.fn();
    r.subscribeFileIcons(gone)();
    r.subscribeFileIcons(kept);
    await r.preloadFileIcons();
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("recovers from a failed chunk load on the next demand", async () => {
    const r = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    loads.fail = 1;
    await r.preloadFileIcons();
    expect(r.peekFileIconUrl("a.ts")).toBe("");
    expect(warn).toHaveBeenCalled();

    await r.preloadFileIcons();
    expect(r.peekFileIconUrl("a.ts")).toBe("file:a.ts");
  });
});
