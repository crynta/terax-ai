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

function pointerEvent(flags: { metaKey?: boolean; touch?: boolean } = {}) {
  return Object.assign(new Event("pointermove"), {
    clientX: 10,
    clientY: 10,
    metaKey: flags.metaKey ?? false,
    ctrlKey: false,
    shiftKey: false,
    pointerType: flags.touch ? "touch" : "mouse",
  });
}

function setup() {
  const target = new EventTarget() as unknown as HTMLElement;
  const keys = new EventTarget();
  const links = new LazyTerminalLinks({
    target,
    keyTarget: keys as unknown as Window,
    isModifier: (event) => event.metaKey || event.ctrlKey,
    cellAt: () => null,
    blocked: () => false,
    model: { linkSource: vi.fn() },
    geometry: () => ({ cellWidth: 8, cellHeight: 16, shiftY: 0, color: "red" }),
    setPointerCursor: vi.fn(),
    onActivate: vi.fn(),
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { target, keys, links, tick };
}

describe("LazyTerminalLinks", () => {
  it("loads nothing while the modifier is never held", async () => {
    const { target, keys, tick } = setup();
    for (let i = 0; i < 5; i += 1) target.dispatchEvent(pointerEvent());
    keys.dispatchEvent(Object.assign(new Event("keydown"), { metaKey: false }));
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
  });

  it("loads on the first move with the modifier and hands the pointer over", async () => {
    const { target, tick } = setup();
    const event = pointerEvent({ metaKey: true });
    target.dispatchEvent(event);
    target.dispatchEvent(pointerEvent({ metaKey: true }));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
    expect(active.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ metaKey: true }),
    );
  });

  it("loads when the modifier is pressed over a resting pointer", async () => {
    const { target, keys, tick } = setup();
    target.dispatchEvent(pointerEvent());
    keys.dispatchEvent(Object.assign(new Event("keydown"), { metaKey: true }));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledOnce();
    expect(active.ingest).toHaveBeenCalledOnce();
  });

  it("ignores touch and a key press with no pointer over the terminal", async () => {
    const { target, keys, tick } = setup();
    keys.dispatchEvent(Object.assign(new Event("keydown"), { metaKey: true }));
    target.dispatchEvent(pointerEvent({ metaKey: true, touch: true }));
    await tick();
    expect(createTerminalLinks).not.toHaveBeenCalled();
  });

  it("forwards invalidation once loaded and releases everything on dispose", async () => {
    const { target, links, tick } = setup();
    links.invalidate();
    expect(active.invalidate).not.toHaveBeenCalled();
    target.dispatchEvent(pointerEvent({ metaKey: true }));
    await tick();
    links.invalidate();
    expect(active.invalidate).toHaveBeenCalledOnce();
    links.dispose();
    expect(active.dispose).toHaveBeenCalledOnce();
    links.dispose();
    expect(active.dispose).toHaveBeenCalledOnce();
  });

  it("does not build links for a terminal disposed while they loaded", async () => {
    const { target, links, tick } = setup();
    target.dispatchEvent(pointerEvent({ metaKey: true }));
    links.dispose();
    await tick();
    expect(active.ingest).not.toHaveBeenCalled();
  });

  it("retries after a failed load", async () => {
    const { target, tick } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createTerminalLinks.mockImplementationOnce(() => {
      throw new Error("chunk failed");
    });
    target.dispatchEvent(pointerEvent({ metaKey: true }));
    await tick();
    target.dispatchEvent(pointerEvent({ metaKey: true }));
    await tick();
    expect(createTerminalLinks).toHaveBeenCalledTimes(2);
    expect(active.ingest).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
