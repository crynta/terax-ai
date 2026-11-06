import { afterEach, describe, expect, it, vi } from "vitest";

const active = {
  ingest: vi.fn(),
  invalidate: vi.fn(),
  dispose: vi.fn(),
};
const createTerminalLinks = vi.fn(() => active);

vi.mock("./terminalLinksRuntime", () => ({ createTerminalLinks }));

import { LazyTerminalLinks } from "./LazyTerminalLinks";

afterEach(() => vi.clearAllMocks());

type Flags = { metaKey?: boolean; touch?: boolean; button?: number };

function pointer(type: string, flags: Flags = {}) {
  return Object.assign(new Event(type), {
    clientX: 10,
    clientY: 10,
    button: flags.button ?? 0,
    metaKey: flags.metaKey ?? false,
    ctrlKey: false,
    shiftKey: false,
    pointerType: flags.touch ? "touch" : "mouse",
  });
}

const key = (type: string, metaKey: boolean) =>
  Object.assign(new Event(type), { metaKey, ctrlKey: false, shiftKey: false });

/** An event target that knows how many listeners of each type it holds. */
class CountingTarget extends EventTarget {
  private readonly held = new Map<string, Set<unknown>>();

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const set = this.held.get(type) ?? new Set();
    set.add(listener);
    this.held.set(type, set);
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    this.held.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }

  count(type: string): number {
    return this.held.get(type)?.size ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const set of this.held.values()) sum += set.size;
    return sum;
  }
}

function setup() {
  const target = new CountingTarget();
  const keys = new CountingTarget();
  const links = new LazyTerminalLinks({
    target: target as unknown as HTMLElement,
    keyTarget: keys as unknown as Window,
    isModifier: (event) => event.metaKey || event.ctrlKey,
    model: { linkSource: vi.fn(), cols: 80, rows: 24, modes: vi.fn() },
    scrollbar: {} as Node,
    geometry: () => ({ cellWidth: 8, cellHeight: 16, shiftY: 0, color: "red" }),
    onActivate: vi.fn(),
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const ingested = () =>
    active.ingest.mock.calls.map(
      ([event]) => event as Event & { metaKey: boolean },
    );
  return { target, keys, links, tick, ingested };
}

describe("LazyTerminalLinks", () => {
  it("loads nothing while the modifier is never held", async () => {
    const { target, keys, tick } = setup();
    for (let i = 0; i < 5; i += 1) target.dispatchEvent(pointer("pointermove"));
    target.dispatchEvent(pointer("pointerdown"));
    target.dispatchEvent(pointer("pointerup"));
    keys.dispatchEvent(key("keydown", false));
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
  });

  it("loads on the first move with the modifier and hands the pointer over", async () => {
    const { target, tick, ingested } = setup();
    const first = pointer("pointermove", { metaKey: true });
    const second = pointer("pointermove", { metaKey: true });
    target.dispatchEvent(first);
    target.dispatchEvent(second);
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
    expect(ingested()).toHaveLength(2);
    expect(ingested()[0]).toBe(first);
    expect(ingested()[1]).toBe(second);
  });

  it("keeps a bounded number of events while the code loads, newest last", async () => {
    const { target, tick, ingested } = setup();
    const events = Array.from({ length: 200 }, () =>
      pointer("pointermove", { metaKey: true }),
    );
    for (const event of events) target.dispatchEvent(event);
    await tick();
    expect(ingested().length).toBeLessThanOrEqual(64);
    expect(ingested()[ingested().length - 1]).toBe(events[199]);
  });

  it("loads on a modified press over a pointer that never moved, and replays the click", async () => {
    const { target, tick, ingested } = setup();
    target.dispatchEvent(pointer("pointerdown", { metaKey: true }));
    // The button comes up while the code is still loading.
    target.dispatchEvent(pointer("pointerup", { metaKey: true }));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
    expect(ingested().map((event) => event.type)).toEqual([
      "pointerdown",
      "pointerup",
    ]);
  });

  it("ignores presses that are not a plain primary-button click with the modifier", async () => {
    const { target, tick } = setup();
    target.dispatchEvent(pointer("pointerdown"));
    target.dispatchEvent(pointer("pointerdown", { metaKey: true, button: 2 }));
    target.dispatchEvent(
      pointer("pointerdown", { metaKey: true, touch: true }),
    );
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
  });

  it("loads when the modifier is pressed over a resting pointer and replays that key", async () => {
    const { target, keys, tick, ingested } = setup();
    target.dispatchEvent(pointer("pointermove"));
    keys.dispatchEvent(key("keydown", true));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
    const [move, press] = ingested();
    expect(move.type).toBe("pointermove");
    expect(move.metaKey).toBe(false);
    // The interaction must learn about the key that woke it up.
    expect(press.type).toBe("keydown");
    expect(press.metaKey).toBe(true);
  });

  it("keeps the modifier changes that happen while the code loads, in order", async () => {
    const { target, keys, tick, ingested } = setup();
    target.dispatchEvent(pointer("pointermove"));
    keys.dispatchEvent(key("keydown", true));
    keys.dispatchEvent(key("keyup", false));
    await tick();
    expect(ingested().map((event) => [event.type, event.metaKey])).toEqual([
      ["pointermove", false],
      ["keydown", true],
      ["keyup", false],
    ]);
  });

  it("hands over nothing further once the links run on their own", async () => {
    const { target, keys, tick } = setup();
    target.dispatchEvent(pointer("pointermove", { metaKey: true }));
    await tick();
    expect(active.ingest).toHaveBeenCalledOnce();
    target.dispatchEvent(pointer("pointerup", { metaKey: true }));
    target.dispatchEvent(pointer("pointermove", { metaKey: true }));
    keys.dispatchEvent(key("keydown", true));
    expect(active.ingest).toHaveBeenCalledOnce();
    expect(target.total()).toBe(0);
    expect(keys.total()).toBe(0);
  });

  it("ignores touch and a key press with no pointer over the terminal", async () => {
    const { target, keys, tick } = setup();
    keys.dispatchEvent(key("keydown", true));
    target.dispatchEvent(
      pointer("pointermove", { metaKey: true, touch: true }),
    );
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
  });

  it("stops listening for keys when the pointer leaves, so a key press elsewhere loads nothing", async () => {
    const { target, keys, tick } = setup();
    target.dispatchEvent(pointer("pointermove"));
    expect(keys.count("keydown")).toBe(1);
    target.dispatchEvent(new Event("pointerleave"));
    expect(keys.count("keydown")).toBe(0);
    keys.dispatchEvent(key("keydown", true));
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
    // Coming back binds them again.
    target.dispatchEvent(pointer("pointermove"));
    expect(keys.count("keydown")).toBe(1);
    keys.dispatchEvent(key("keydown", true));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
  });

  it("does not hand over what happened before the pointer left while the code loaded", async () => {
    const { target, keys, tick, ingested } = setup();
    target.dispatchEvent(pointer("pointerdown", { metaKey: true }));
    target.dispatchEvent(new Event("pointerleave"));
    keys.dispatchEvent(key("keyup", false));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
    expect(ingested()).toEqual([]);
    expect(keys.total()).toBe(0);
  });

  it("forwards invalidation once loaded and releases everything on dispose", async () => {
    const { target, links, tick } = setup();
    links.invalidate();
    expect(active.invalidate).not.toHaveBeenCalled();
    target.dispatchEvent(pointer("pointermove", { metaKey: true }));
    await tick();
    links.invalidate();
    expect(active.invalidate).toHaveBeenCalledOnce();
    links.dispose();
    expect(active.dispose).toHaveBeenCalledOnce();
    links.dispose();
    expect(active.dispose).toHaveBeenCalledOnce();
  });

  it("removes every listener when disposed, loaded or not", () => {
    const { target, keys, links } = setup();
    target.dispatchEvent(pointer("pointermove"));
    links.dispose();
    expect(target.total()).toBe(0);
    expect(keys.total()).toBe(0);
  });

  it("does not build links for a terminal disposed while they loaded", async () => {
    const { target, links, tick } = setup();
    target.dispatchEvent(pointer("pointermove", { metaKey: true }));
    links.dispose();
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
    expect(active.ingest).not.toHaveBeenCalled();
  });

  it("retries after a failed load", async () => {
    const { target, tick } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createTerminalLinks.mockImplementationOnce(() => {
      throw new Error("chunk failed");
    });
    target.dispatchEvent(pointer("pointermove", { metaKey: true }));
    await tick();
    target.dispatchEvent(pointer("pointermove", { metaKey: true }));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledTimes(2);
    expect(active.ingest).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
