import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTerminalResizeGestureForTest } from "@/modules/terminal/lib/terminalResizeGesture";
import type { CssRect } from "./PaneRects";
import {
  findTerminalArea,
  GEOMETRY_CHECK_INTERVAL_MS,
  HIDE_DELAY_MS,
  WebGpuWindowCanvas,
  type WindowCanvasPane,
  windowFrameNeeded,
} from "./WebGpuWindowCanvas";

afterEach(() => {
  resetTerminalResizeGestureForTest();
  vi.unstubAllGlobals();
});

describe("windowFrameNeeded", () => {
  const idle = {
    paneChanged: false,
    dirty: false,
    reallocated: false,
    moved: 0,
    drawable: 2,
  };

  it("draws nothing, and acquires no texture, when nothing changed", () => {
    expect(windowFrameNeeded(idle)).toBe(false);
  });

  it.each([
    ["a pane's pixels changed", { paneChanged: true }],
    ["the window was marked dirty", { dirty: true }],
    ["the canvas was reallocated and is blank", { reallocated: true }],
    ["a pane moved or resized", { moved: 1 }],
  ])("draws when %s", (_name, change) => {
    expect(windowFrameNeeded({ ...idle, ...change })).toBe(true);
  });

  it("never draws when no pane can be drawn", () => {
    expect(
      windowFrameNeeded({
        paneChanged: true,
        dirty: true,
        reallocated: true,
        moved: 3,
        drawable: 0,
      }),
    ).toBe(false);
  });
});

describe("findTerminalArea", () => {
  const closest =
    (marked: Record<string, unknown>) =>
    (selector: string): unknown =>
      marked[selector] ?? null;

  it("prefers a marked ancestor, then the stack's area layer, then the parent, then the host", () => {
    const ancestor = {} as HTMLElement;
    const layer = {} as HTMLElement;
    const parent = {} as HTMLElement;
    const stack = { querySelector: () => layer };
    expect(
      findTerminalArea({
        closest: closest({ "[data-terminal-area]": ancestor }),
        parentElement: parent,
      } as unknown as HTMLElement),
    ).toBe(ancestor);
    expect(
      findTerminalArea({
        closest: closest({ "[data-terminal-stack]": stack }),
        parentElement: parent,
      } as unknown as HTMLElement),
    ).toBe(layer);
    expect(
      findTerminalArea({
        closest: closest({}),
        parentElement: parent,
      } as unknown as HTMLElement),
    ).toBe(parent);
    const bare = {} as HTMLElement;
    expect(findTerminalArea(bare)).toBe(bare);
  });

  it("asks the stack for the layer that is its own child, not any nested one", () => {
    const querySelector = vi.fn(() => null);
    findTerminalArea({
      closest: closest({ "[data-terminal-stack]": { querySelector } }),
      parentElement: null,
    } as unknown as HTMLElement);
    expect(querySelector).toHaveBeenCalledWith(":scope > [data-terminal-area]");
  });
});

type FakeCanvas = {
  width: number;
  height: number;
  style: Record<string, string>;
  setAttribute: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getContext: () => unknown;
};

function setup(options: { scale?: number } = {}) {
  const context = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({ createView: () => ({}) })),
  };
  const canvases: FakeCanvas[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas: FakeCanvas = {
        width: 300,
        height: 150,
        style: {},
        setAttribute: vi.fn(),
        remove: vi.fn(),
        getContext: () => context,
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  let scale = options.scale ?? 1;
  vi.stubGlobal("window", {
    get devicePixelRatio() {
      return scale;
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  let observed: ((entries: unknown[]) => void) | null = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: unknown[]) => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const rectReads = vi.fn();
  const area = {
    rect: { left: 0, top: 0, width: 800, height: 600 } as CssRect,
    insertBefore: vi.fn(),
    firstChild: null,
    getBoundingClientRect() {
      rectReads();
      return area.rect;
    },
  };
  const requestFrame = vi.fn();
  const device = { limits: { maxTextureDimension2D: 16384 } } as GPUDevice;
  const canvas = new WebGpuWindowCanvas(
    { device, format: "bgra8unorm", generation: 1 },
    { requestFrame },
  );
  canvas.mount(area as unknown as HTMLElement);
  const pass = {
    setViewport: vi.fn(),
    setScissorRect: vi.fn(),
    end: vi.fn(),
  };
  const encoder = {
    beginRenderPass: vi.fn(() => pass),
  } as unknown as GPUCommandEncoder;
  const pane = (background: readonly [number, number, number] = [1, 2, 3]) =>
    ({
      drawable: vi.fn(() => true),
      background: vi.fn(() => background),
      encode: vi.fn(),
    }) satisfies WindowCanvasPane;
  const host = (rect: CssRect) => {
    const value = {
      rect,
      getBoundingClientRect(): CssRect {
        rectReads();
        return value.rect;
      },
    };
    return value;
  };
  return {
    canvas,
    area,
    context,
    canvases,
    pass,
    encoder,
    pane,
    host,
    requestFrame,
    rectReads,
    resizeArea(width: number, height: number) {
      area.rect = { ...area.rect, width, height };
      observed?.([
        {
          contentRect: { width, height },
          devicePixelContentBoxSize: [
            {
              inlineSize: Math.round(width * scale),
              blockSize: Math.round(height * scale),
            },
          ],
        },
      ]);
    },
    setScale(value: number) {
      scale = value;
    },
    resources: {} as never,
  };
}

describe("WebGpuWindowCanvas", () => {
  it("is placed first in its area and sized to it exactly, in device pixels, at the first frame", () => {
    const t = setup({ scale: 2 });
    expect(t.area.insertBefore).toHaveBeenCalledWith(t.canvases[0], null);
    expect(t.canvases[0].style.pointerEvents).toBeUndefined();
    t.canvas.beginFrame();
    expect(t.canvases[0]).toMatchObject({ width: 1600, height: 1200 });
    expect(t.canvases[0].style).toMatchObject({
      width: "800px",
      height: "600px",
    });
    expect(t.canvas.diagnostics().reallocations).toBe(1);
  });

  it("computes pane rectangles in device pixels, clamped to the canvas, only when the layout changed", () => {
    const t = setup({ scale: 1.25 });
    const a = t.pane();
    const b = t.pane();
    const bindingA = t.canvas.addPane(
      a,
      t.host({ left: 0, top: 0, width: 399.5, height: 600 }) as never,
    );
    const bindingB = t.canvas.addPane(
      b,
      t.host({ left: 400.5, top: 0, width: 399.5, height: 600 }) as never,
    );
    bindingA.setBounds({ left: 0, top: 0, width: 399.5, height: 600 });
    bindingB.setBounds({ left: 400.5, top: 0, width: 399.5, height: 600 });
    const first = t.canvas.beginFrame();
    expect(first.moved).toEqual([a, b]);
    expect(bindingA.rect()).toEqual({ x: 0, y: 0, width: 499, height: 750 });
    expect(bindingB.rect()).toEqual({ x: 501, y: 0, width: 499, height: 750 });
    // Nothing changed: the next frame recomputes nothing and moves nothing.
    expect(t.canvas.beginFrame().moved).toEqual([]);
    // The same bounds again are not a change.
    bindingA.setBounds({ left: 0, top: 0, width: 399.5, height: 600 });
    expect(t.canvas.beginFrame().moved).toEqual([]);
    // A divider drag moves both.
    bindingA.setBounds({ left: 0, top: 0, width: 300, height: 600 });
    bindingB.setBounds({ left: 301, top: 0, width: 499, height: 600 });
    const drag = t.canvas.beginFrame();
    expect(drag.moved).toEqual([a, b]);
    expect(drag.reallocated).toBe(false);
    expect(bindingB.rect()).toEqual({ x: 376, y: 0, width: 624, height: 750 });
  });

  it("puts the canvas on the device pixel grid when the area sits between pixels", () => {
    const t = setup({ scale: 1.25 });
    t.area.rect = { left: 100.4, top: 20, width: 700, height: 500 };
    t.resizeArea(700, 500);
    expect(t.canvases[0].style.transform).toBe("translate(0.4px, 0px)");
    t.area.rect = { left: 100, top: 20, width: 700, height: 500 };
    t.resizeArea(700, 500);
    expect(t.canvases[0].style.transform).toBe("");
  });

  it("never sizes the canvas past what the device allows", () => {
    const t = setup();
    (t.canvas as unknown as { device: GPUDevice }).device = {
      limits: { maxTextureDimension2D: 640 },
    } as GPUDevice;
    t.resizeArea(1000, 700);
    t.canvas.beginFrame();
    expect(t.canvases[0]).toMatchObject({ width: 640, height: 640 });
  });

  it("cuts a pane that reaches past a canvas that has not grown yet", () => {
    const t = setup();
    const p = t.pane();
    const binding = t.canvas.addPane(
      p,
      t.host({ left: 0, top: 0, width: 1000, height: 600 }) as never,
    );
    binding.setBounds({ left: 0, top: 0, width: 1000, height: 600 });
    t.canvas.beginFrame();
    // The viewport must stay inside the render target: WebGPU rejects anything else.
    expect(binding.rect()).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("clears with the first drawable pane's background and draws every drawable pane with its viewport and scissor", () => {
    const t = setup();
    const hidden = t.pane([9, 9, 9]);
    hidden.drawable.mockReturnValue(false);
    const a = t.pane([10, 20, 30]);
    const b = t.pane([40, 50, 60]);
    for (const [p, left] of [
      [hidden, 0],
      [a, 0],
      [b, 400],
    ] as const) {
      t.canvas
        .addPane(p, t.host({ left, top: 0, width: 400, height: 600 }) as never)
        .setBounds({ left, top: 0, width: 400, height: 600 });
    }
    t.canvas.beginFrame();
    const result = t.canvas.encode(t.encoder, t.resources);
    expect(result.drawn).toBe(2);
    expect(result.revealed).toEqual([a, b]);
    const descriptor = (t.encoder.beginRenderPass as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(descriptor.colorAttachments[0]).toMatchObject({
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 10 / 255, g: 20 / 255, b: 30 / 255, a: 1 },
    });
    expect(t.pass.setViewport.mock.calls).toEqual([
      [0, 0, 400, 600, 0, 1],
      [400, 0, 400, 600, 0, 1],
    ]);
    expect(t.pass.setScissorRect.mock.calls).toEqual([
      [0, 0, 400, 600],
      [400, 0, 400, 600],
    ]);
    expect(hidden.encode).not.toHaveBeenCalled();
    expect(t.pass.end).toHaveBeenCalledOnce();
    // A second frame reveals nobody new.
    expect(t.canvas.encode(t.encoder, t.resources).revealed).toEqual([]);
    expect(t.canvases[0].style.visibility).toBe("visible");
  });

  it("acquires no texture when no pane can be drawn", () => {
    const t = setup();
    const p = t.pane();
    p.drawable.mockReturnValue(false);
    t.canvas
      .addPane(p, t.host({ left: 0, top: 0, width: 400, height: 600 }) as never)
      .setBounds({ left: 0, top: 0, width: 400, height: 600 });
    t.canvas.beginFrame();
    expect(t.canvas.encode(t.encoder, t.resources).drawn).toBe(0);
    expect(t.context.getCurrentTexture).not.toHaveBeenCalled();
    expect(t.encoder.beginRenderPass).not.toHaveBeenCalled();
  });

  it("keeps its allocation across pane changes and hides itself when the last pane leaves", () => {
    const t = setup();
    const a = t.pane();
    t.canvas
      .addPane(a, t.host({ left: 0, top: 0, width: 800, height: 600 }) as never)
      .setBounds({ left: 0, top: 0, width: 800, height: 600 });
    t.canvas.beginFrame();
    t.canvas.encode(t.encoder, t.resources);
    for (let cycle = 0; cycle < 50; cycle++) {
      t.canvas.removePane(a);
      // The next pane of the switch joins within the delay: the canvas is never toggled.
      expect(t.canvases[0].style.visibility).toBe("visible");
      const b = t.pane();
      t.canvas
        .addPane(
          b,
          t.host({ left: 0, top: 0, width: 400, height: 600 }) as never,
        )
        .setBounds({ left: 0, top: 0, width: 400, height: 600 });
      t.canvas.beginFrame();
      t.canvas.encode(t.encoder, t.resources);
      t.canvas.removePane(b);
      t.canvas
        .addPane(
          a,
          t.host({ left: 0, top: 0, width: 800, height: 600 }) as never,
        )
        .setBounds({ left: 0, top: 0, width: 800, height: 600 });
      t.canvas.beginFrame();
      t.canvas.encode(t.encoder, t.resources);
    }
    expect(t.canvas.diagnostics().reallocations).toBe(1);
    expect(t.canvases).toHaveLength(1);
    expect(t.context.unconfigure).not.toHaveBeenCalled();
  });

  it("hides itself only after staying empty for a moment, and not when a pane returns", () => {
    vi.useFakeTimers();
    const t = setup();
    const a = t.pane();
    t.canvas
      .addPane(a, t.host({ left: 0, top: 0, width: 800, height: 600 }) as never)
      .setBounds({ left: 0, top: 0, width: 800, height: 600 });
    t.canvas.beginFrame();
    t.canvas.encode(t.encoder, t.resources);
    t.canvas.removePane(a);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(t.canvases[0].style.visibility).toBe("visible");
    t.canvas.addPane(
      a,
      t.host({ left: 0, top: 0, width: 800, height: 600 }) as never,
    );
    vi.advanceTimersByTime(1);
    expect(t.canvases[0].style.visibility).toBe("visible");
    t.canvas.removePane(a);
    vi.advanceTimersByTime(HIDE_DELAY_MS);
    expect(t.canvases[0].style.visibility).toBe("hidden");
    vi.useRealTimers();
  });

  it("follows an area resize with one reallocation per distinct size and reuses nearby sizes", () => {
    const t = setup();
    t.canvas.beginFrame();
    t.resizeArea(1000, 700);
    expect(t.canvas.beginFrame().reallocated).toBe(true);
    // A few pixels either way keeps the backing.
    t.resizeArea(1003, 702);
    expect(t.canvas.beginFrame().reallocated).toBe(false);
    t.resizeArea(998, 699);
    expect(t.canvas.beginFrame().reallocated).toBe(false);
    expect(t.canvas.diagnostics().reallocations).toBe(2);
  });

  describe("geometry check", () => {
    it("reads no layout until the interval has passed, then finds a pane that moved without resizing", () => {
      const t = setup();
      const p = t.pane();
      const host = t.host({ left: 0, top: 0, width: 400, height: 600 });
      const binding = t.canvas.addPane(p, host as never);
      binding.setBounds(host.rect);
      t.canvas.beginFrame();
      t.rectReads.mockClear();

      t.canvas.verifyGeometry(0);
      t.canvas.verifyGeometry(GEOMETRY_CHECK_INTERVAL_MS - 1);
      expect(t.rectReads).toHaveBeenCalledTimes(2); // area and pane, once
      host.rect = { left: 20, top: 0, width: 400, height: 600 };
      t.canvas.verifyGeometry(GEOMETRY_CHECK_INTERVAL_MS);
      expect(binding.rect()).toEqual({ x: 0, y: 0, width: 400, height: 600 });
      const start = t.canvas.beginFrame();
      expect(start.moved).toEqual([p]);
      expect(binding.rect()).toEqual({ x: 20, y: 0, width: 400, height: 600 });
      expect(t.canvas.diagnostics().geometryCorrections).toBe(1);
      expect(t.canvas.isDirty).toBe(true);
    });

    it("does nothing when the layout is as the observers left it", () => {
      const t = setup();
      const p = t.pane();
      const host = t.host({ left: 0, top: 0, width: 400, height: 600 });
      t.canvas.addPane(p, host as never).setBounds(host.rect);
      t.canvas.beginFrame();
      t.canvas.consumeDirty();
      t.canvas.verifyGeometry(5_000);
      expect(t.canvas.diagnostics().geometryCorrections).toBe(0);
      expect(t.canvas.isDirty).toBe(false);
    });
  });

  it("is reconfigured for a replacement device without being replaced", () => {
    const t = setup();
    t.canvas.beginFrame();
    t.canvas.consumeDirty();
    const next = { limits: { maxTextureDimension2D: 8192 } } as GPUDevice;
    t.canvas.reconfigure({ device: next, format: "bgra8unorm", generation: 2 });
    t.canvas.reconfigure({ device: next, format: "bgra8unorm", generation: 2 });
    expect(t.context.configure).toHaveBeenCalledTimes(2);
    expect(t.context.unconfigure).not.toHaveBeenCalled();
    expect(t.canvas.diagnostics().reconfigured).toBe(1);
    expect(t.canvas.isDirty).toBe(true);
  });

  it("re-snaps the canvas to the device pixel grid when only the display ratio changes", () => {
    const t = setup({ scale: 1.25 });
    t.area.rect = { left: 100.4, top: 20, width: 700, height: 500 };
    t.resizeArea(700, 500);
    expect(t.canvases[0].style.transform).toBe("translate(0.4px, 0px)");
    // The window moves to a display with another ratio: the rectangle is the same CSS box, so
    // nothing re-measured it, but the translation that lands it on a device pixel is different.
    t.setScale(1);
    const onResize = (
      (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        ([name]) => name === "resize",
      ) as [string, () => void]
    )[1];
    onResize();
    const x = Number.parseFloat(
      /translate\((-?[\d.]+)px/.exec(t.canvases[0].style.transform)?.[1] ?? "",
    );
    expect(x).toBeCloseTo(-0.4, 6);
    // And back to a ratio at which the box already sits on a pixel: no transform at all.
    t.area.rect = { left: 100, top: 20, width: 700, height: 500 };
    t.setScale(2);
    onResize();
    expect(t.canvases[0].style.transform).toBe("");
  });

  it("clips a pane laid out partly left of or above the canvas instead of sliding it in", () => {
    const t = setup();
    const p = t.pane();
    const binding = t.canvas.addPane(
      p,
      t.host({ left: -3, top: -2, width: 100, height: 100 }) as never,
    );
    binding.setBounds({ left: -3, top: -2, width: 100, height: 100 });
    t.canvas.beginFrame();
    // The viewport stays inside the target; what was cut off is reported, so the pane's own
    // origin (x - clipX) stays where the layout put it.
    expect(binding.rect()).toEqual({
      x: 0,
      y: 0,
      width: 97,
      height: 98,
      clipX: 3,
      clipY: 2,
    });
    // Moving it fully inside drops the clip.
    binding.setBounds({ left: 0, top: 0, width: 100, height: 100 });
    t.canvas.beginFrame();
    expect(binding.rect()).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("reveals every pane again after the canvas was reconfigured for a replacement device", () => {
    const t = setup();
    const a = t.pane();
    t.canvas
      .addPane(a, t.host({ left: 0, top: 0, width: 400, height: 600 }) as never)
      .setBounds({ left: 0, top: 0, width: 400, height: 600 });
    t.canvas.beginFrame();
    expect(t.canvas.encode(t.encoder, t.resources).revealed).toEqual([a]);
    expect(t.canvas.encode(t.encoder, t.resources).revealed).toEqual([]);
    // Reconfiguring clears the canvas and the panes cover it again until it has been redrawn.
    t.canvas.reconfigure({
      device: { limits: { maxTextureDimension2D: 8192 } } as GPUDevice,
      format: "bgra8unorm",
      generation: 2,
    });
    t.canvas.beginFrame();
    expect(t.canvas.encode(t.encoder, t.resources).revealed).toEqual([a]);
  });

  it("asks for a frame when its area changes", () => {
    const t = setup();
    t.requestFrame.mockClear();
    t.resizeArea(900, 600);
    expect(t.requestFrame).toHaveBeenCalled();
  });
});
