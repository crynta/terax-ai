import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalLinkHover, terminalLinkSegments } from "./TerminalLinkHover";

const COLS = 10;
const ROWS = 4;

/** A 10x4 grid whose link covers cells 7..12 (row 0 col 7 through row 1 col 2). */
function linkModel(mouseTracking: boolean) {
  return {
    cols: COLS,
    rows: ROWS,
    modes: () => ({
      alternateScreen: false,
      bracketedPaste: false,
      focusReporting: false,
      mouseTracking,
      synchronizedOutput: false,
    }),
    hyperlinkAtViewportCell: (row: number, column: number) => {
      const index = row * COLS + column;
      return index >= 7 && index <= 12 ? "src/a.ts:3" : null;
    },
  };
}

function fakeElement() {
  return Object.assign(new EventTarget(), {
    style: {} as Record<string, string>,
    append: vi.fn(),
    remove: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
}

function harness(mouseTracking: boolean) {
  const created: ReturnType<typeof fakeElement>[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const element = fakeElement();
      created.push(element);
      return element;
    },
  });
  const root = fakeElement();
  const onOpenLink = vi.fn();
  const hover = new TerminalLinkHover({
    root: root as unknown as HTMLElement,
    model: linkModel(mouseTracking) as never,
    cellSize: () => ({ width: 10, height: 20 }),
    gridShiftY: () => 0,
    active: () => true,
    ignoreTarget: () => false,
    underlineColor: () => "rgb(1, 2, 3)",
    onOpenLink,
    isMac: true,
  });
  const mouse = (type: string, column: number, row: number, metaKey = false) =>
    root.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        clientX: column * 10 + 5,
        clientY: row * 20 + 5,
        metaKey,
        shiftKey: false,
      }),
    );
  return { root, hover, onOpenLink, mouse, created };
}

describe("terminalLinkSegments", () => {
  it("follows a link across the row end, one segment per row", () => {
    expect(terminalLinkSegments(linkModel(false), 1, 1, "src/a.ts:3")).toEqual([
      { row: 0, start: 7, end: 9 },
      { row: 1, start: 0, end: 2 },
    ]);
  });
});

describe("TerminalLinkHover", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("underlines the hovered link and opens it on a plain click", () => {
    const { root, hover, onOpenLink, mouse, created } = harness(false);
    mouse("mousemove", 8, 0);
    expect(root.style.cursor).toBe("pointer");
    expect(created.map((line) => [line.style.left, line.style.width])).toEqual([
      ["70px", "30px"],
      ["0px", "30px"],
    ]);
    expect(created[0].style.backgroundColor).toBe("rgb(1, 2, 3)");
    mouse("mousedown", 8, 0);
    mouse("mouseup", 9, 0);
    expect(onOpenLink).toHaveBeenCalledWith("src/a.ts:3");
    mouse("mousemove", 0, 3);
    expect(created.every((line) => line.style.display === "none")).toBe(true);
    hover.dispose();
  });

  it("answers only to Cmd while the application tracks the mouse", () => {
    const { root, hover, onOpenLink, mouse } = harness(true);
    mouse("mousemove", 8, 0);
    expect(root.style.cursor).toBe("text");
    mouse("mousedown", 8, 0);
    mouse("mouseup", 8, 0);
    expect(onOpenLink).not.toHaveBeenCalled();
    mouse("mousedown", 8, 0, true);
    // The agent redraws between press and release.
    hover.refresh();
    mouse("mouseup", 8, 0, true);
    expect(onOpenLink).toHaveBeenCalledOnce();
    hover.dispose();
  });
});
