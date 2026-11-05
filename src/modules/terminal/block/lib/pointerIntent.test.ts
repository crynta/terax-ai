import { afterEach, describe, expect, it, vi } from "vitest";
import { createPointerIntent } from "./pointerIntent";

describe("createPointerIntent", () => {
  it("treats the first position as a baseline, not intent", () => {
    const moved = createPointerIntent();
    expect(moved(10, 20)).toBe(false);
  });

  it("ignores repeats of the resting position (content scrolled underneath)", () => {
    const moved = createPointerIntent();
    moved(10, 20);
    expect(moved(10, 20)).toBe(false);
    expect(moved(10, 20)).toBe(false);
  });

  it("reports a real move and then rests at the new position", () => {
    const moved = createPointerIntent();
    moved(10, 20);
    expect(moved(10, 21)).toBe(true);
    expect(moved(10, 21)).toBe(false);
    expect(moved(11, 21)).toBe(true);
  });
});

describe("createPointerIntent with a seed", () => {
  it("takes a first event at a new position as intent (the pointer entered in one move)", () => {
    const moved = createPointerIntent({ x: 10, y: 20 });
    expect(moved(40, 60)).toBe(true);
    expect(moved(40, 60)).toBe(false);
  });

  it("ignores a first event where the pointer was already resting", () => {
    const moved = createPointerIntent({ x: 10, y: 20 });
    expect(moved(10, 20)).toBe(false);
  });
});

describe("trackPointer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load() {
    let listener:
      | ((event: { clientX: number; clientY: number }) => void)
      | undefined;
    const addEventListener = vi.fn(
      (_type: string, handler: typeof listener) => {
        listener = handler;
      },
    );
    vi.stubGlobal("document", { addEventListener });
    vi.resetModules();
    const module = await import("./pointerIntent");
    return {
      ...module,
      addEventListener,
      move: (x: number, y: number) => listener?.({ clientX: x, clientY: y }),
    };
  }

  it("seeds a new tracker with the last position seen anywhere", async () => {
    const { trackPointer, createPointerIntent, move } = await load();
    trackPointer();
    move(5, 6);
    const moved = createPointerIntent();
    expect(moved(5, 6)).toBe(false);
    expect(moved(30, 6)).toBe(true);
  });

  it("installs one document listener however often it is called", async () => {
    const { trackPointer, addEventListener } = await load();
    trackPointer();
    trackPointer();
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });

  it("has no position to seed from until the pointer has moved", async () => {
    const { trackPointer, createPointerIntent } = await load();
    trackPointer();
    expect(createPointerIntent()(5, 6)).toBe(false);
  });
});
