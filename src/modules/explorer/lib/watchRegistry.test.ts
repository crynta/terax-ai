import { describe, expect, it, vi } from "vitest";
import { createWatchRegistry, planVisibilityEdge } from "./watchRegistry";

function setup(armed = true) {
  const io = { add: vi.fn(), remove: vi.fn() };
  return { io, registry: createWatchRegistry(io, armed) };
}

describe("createWatchRegistry", () => {
  it("registers natively only while armed, once per path", () => {
    const { io, registry } = setup();
    registry.add("/a");
    registry.add("/a");
    registry.addMany(["/a", "/b", "/c"]);
    expect(io.add.mock.calls).toEqual([[["/a"]], [["/b", "/c"]]]);
    registry.remove("/b");
    registry.remove("/b");
    registry.removeMany(["/c", "/nope"]);
    expect(io.remove.mock.calls).toEqual([[["/b"]], [["/c"]]]);
    expect(registry.paths()).toEqual(["/a"]);
  });

  it("makes no native calls at all while disarmed, however the set changes", () => {
    const { io, registry } = setup(false);
    registry.add("/a");
    registry.addMany(["/b", "/c"]);
    registry.remove("/b");
    registry.removeMany(["/c"]);
    expect(io.add).not.toHaveBeenCalled();
    expect(io.remove).not.toHaveBeenCalled();
    expect(registry.paths()).toEqual(["/a"]);
    expect(registry.armed).toBe(false);
  });

  it("arming registers exactly the current desired set, once", () => {
    const { io, registry } = setup(false);
    registry.addMany(["/a", "/b", "/c"]);
    registry.remove("/b");
    registry.arm();
    registry.arm();
    expect(io.add.mock.calls).toEqual([[["/a", "/c"]]]);
    expect(registry.armed).toBe(true);
  });

  it("disarming releases the natively registered set but remembers it", () => {
    const { io, registry } = setup();
    registry.addMany(["/a", "/b"]);
    io.add.mockClear();
    registry.disarm();
    registry.disarm();
    expect(io.remove.mock.calls).toEqual([[["/a", "/b"]]]);
    expect(registry.has("/a")).toBe(true);

    registry.arm();
    expect(io.add.mock.calls).toEqual([[["/a", "/b"]]]);
  });

  it("does not touch the native side when arming or disarming an empty set", () => {
    const { io, registry } = setup();
    registry.disarm();
    registry.arm();
    expect(io.add).not.toHaveBeenCalled();
    expect(io.remove).not.toHaveBeenCalled();
  });

  it("clear releases natively only when armed and forgets the set", () => {
    const armed = setup();
    armed.registry.addMany(["/a", "/b"]);
    armed.registry.clear();
    expect(armed.io.remove.mock.calls).toEqual([[["/a", "/b"]]]);
    expect(armed.registry.paths()).toEqual([]);

    const idle = setup(false);
    idle.registry.addMany(["/a"]);
    idle.registry.clear();
    expect(idle.io.remove).not.toHaveBeenCalled();
    expect(idle.registry.paths()).toEqual([]);
  });
});

describe("planVisibilityEdge", () => {
  it("hiding releases the watchers and marks the data stale", () => {
    expect(
      planVisibilityEdge({ active: false, stale: false, hasRoot: true }),
    ).toEqual({ arm: false, resync: false, stale: true });
  });

  it("showing after a hide re-arms and reloads exactly once", () => {
    const shown = planVisibilityEdge({
      active: true,
      stale: true,
      hasRoot: true,
    });
    expect(shown).toEqual({ arm: true, resync: true, stale: false });
    // The follow-up run sees the cleared flag and does nothing more.
    expect(
      planVisibilityEdge({ active: true, stale: shown.stale, hasRoot: true }),
    ).toEqual({ arm: true, resync: false, stale: false });
  });

  it("a shown explorer with fresh data never reloads", () => {
    expect(
      planVisibilityEdge({ active: true, stale: false, hasRoot: true }),
    ).toEqual({ arm: true, resync: false, stale: false });
  });

  it("has nothing to reload without a root, but still clears the stale flag", () => {
    expect(
      planVisibilityEdge({ active: true, stale: true, hasRoot: false }),
    ).toEqual({ arm: true, resync: false, stale: false });
  });
});
