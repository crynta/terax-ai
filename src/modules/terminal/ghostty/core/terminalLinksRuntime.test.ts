import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";
import type { ViewportLinkSource } from "./ViewportLinkResolver";
import { createTerminalLinks } from "./terminalLinksRuntime";

class FakeNode {}
const scrollbarNode = new FakeNode();

beforeAll(() => {
  vi.stubGlobal("Node", FakeNode);
});

const TEXT = "see https://example.com/a here";

function source(): ViewportLinkSource {
  const cells = [...TEXT.padEnd(40, " ")];
  return {
    cols: 40,
    rows: 4,
    revision: 1,
    origin: 0,
    cellCount: 160,
    linkIds: new Uint32Array(160),
    rowWrapped: new Uint8Array(4),
    hyperlinkAt: () => null,
    readLines: () => new Map([[0, { cells }]]),
  };
}

function setup(mouseTracking = false) {
  const target = Object.assign(new EventTarget(), {
    style: { cursor: "" },
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
    ownerDocument: { createElement: () => ({ style: {}, setAttribute() {}, replaceChildren() {}, append() {}, remove() {} }) },
    append() {},
  }) as unknown as HTMLElement;
  const scrollbar = { contains: (node: unknown) => node === scrollbarNode } as unknown as Node;
  const onActivate = vi.fn();
  const options: LazyTerminalLinksOptions = {
    target,
    keyTarget: new EventTarget() as unknown as Window,
    isModifier: (event) => event.metaKey || event.ctrlKey,
    model: {
      linkSource: source,
      revision: () => 1,
      viewportOriginLine: () => 0,
      cols: 40,
      rows: 4,
      modes: () => ({ mouseTracking }) as never,
    },
    scrollbar,
    geometry: () => ({ cellWidth: 8, cellHeight: 16, shiftY: 0, color: "red" }),
    onActivate,
  };
  const links = createTerminalLinks(options);
  const fire = (type: string, x: number, y: number, extra = {}) => {
    const { target: eventTarget, ...rest } = extra as { target?: unknown };
    const event = Object.assign(new Event(type, { cancelable: true }), {
      clientX: 100 + x,
      clientY: 50 + y,
      button: 0,
      pointerType: "mouse",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      ...rest,
    });
    if (eventTarget) Object.defineProperty(event, "target", { value: eventTarget });
    target.dispatchEvent(event);
    return event;
  };
  return { links, target, fire, onActivate };
}

describe("createTerminalLinks", () => {
  it("maps the pointer to a cell and activates a detected URL on a modified click", () => {
    const { fire, onActivate, links, target } = setup();
    // Column 8 of row 0 sits inside "https://example.com/a".
    fire("pointermove", 8 * 8 + 2, 5);
    expect(target.style.cursor).toBe("pointer");
    fire("pointerdown", 8 * 8 + 2, 5);
    fire("pointerup", 8 * 8 + 2, 5);
    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "url", uri: "https://example.com/a" }),
    );
    links.dispose();
  });

  it("leaves text that is not a link, and cells outside the grid, alone", () => {
    const { fire, onActivate, links, target } = setup();
    fire("pointermove", 1, 5);
    fire("pointermove", 500, 5);
    fire("pointermove", 20, 16 * 9);
    fire("pointerdown", 1, 5);
    fire("pointerup", 1, 5);
    expect(onActivate).not.toHaveBeenCalled();
    expect(target.style.cursor).not.toBe("pointer");
    links.dispose();
  });

  it("stands aside for an application tracking the mouse unless Shift is held", () => {
    const tracked = setup(true);
    tracked.fire("pointermove", 8 * 8 + 2, 5);
    expect(tracked.target.style.cursor).not.toBe("pointer");
    tracked.fire("pointermove", 8 * 8 + 3, 5, { shiftKey: true });
    expect(tracked.target.style.cursor).toBe("pointer");
    tracked.links.dispose();
  });

  it("stands aside over the scrollbar", () => {
    const { fire, target, links } = setup();
    fire("pointermove", 8 * 8 + 2, 5, { target: scrollbarNode });
    expect(target.style.cursor).not.toBe("pointer");
    links.dispose();
  });
});
