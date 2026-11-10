import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = () => Promise.resolve(undefined);
    set = () => Promise.resolve();
    save = () => Promise.resolve();
  },
}));

const { PINS_PER_SESSION, pinsInOrder, withPinToggled } = await import("./pinnedTurns");

const turn = (id: string, at: string | null = null) => ({ id, summary: `turn ${id}`, at });

describe("pinned turns", () => {
  it("pins, then unpins the same turn, keeping sessions apart", () => {
    let pins = withPinToggled({}, "s1", turn("a"), 1);
    pins = withPinToggled(pins, "s2", turn("a"), 2);
    expect(pins.s1.map((p) => p.id)).toEqual(["a"]);
    pins = withPinToggled(pins, "s1", turn("a"), 3);
    expect(pins.s1).toBeUndefined();
    expect(pins.s2).toHaveLength(1);
  });

  it("lists pins in conversation order, not pin order", () => {
    let pins = withPinToggled({}, "s", turn("late", "2026-11-10T12:00:00Z"), 1);
    pins = withPinToggled(pins, "s", turn("early", "2026-11-10T09:00:00Z"), 2);
    expect(pinsInOrder(pins.s).map((p) => p.id)).toEqual(["early", "late"]);
  });

  it("keeps at most the newest pins per session", () => {
    let pins = {};
    for (let i = 0; i <= PINS_PER_SESSION; i++) pins = withPinToggled(pins, "s", turn(`t${i}`), i);
    const list = (pins as Record<string, { id: string }[]>).s;
    expect(list).toHaveLength(PINS_PER_SESSION);
    expect(list[0].id).toBe("t1");
  });
});
