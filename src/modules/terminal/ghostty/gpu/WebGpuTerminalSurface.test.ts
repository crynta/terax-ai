import { CellFlags } from "@terax/ghostty-core/protocol";
import type { TerminalDamage } from "@/modules/terminal/backend/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { WebGpuTerminalSurface } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalSurface";

const bridge = vi.hoisted(() => ({ runtime: {} as unknown, visible: true }));
vi.mock("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime", () => ({
  getWebGpuTerminalRuntime: async () => bridge.runtime,
}));
vi.mock("@/modules/terminal/ghostty/windowPresentation", () => ({
  terminalWindowPresentation: () => ({
    visible: bridge.visible,
    reclaim: false,
  }),
}));

const surfaces: WebGpuTerminalSurface[] = [];
afterEach(() => {
  for (const surface of surfaces.splice(0)) surface.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WebGPU surface resource lifecycle", () => {
  it("does not upload or present unchanged output and only uploads uniforms for cursor movement", async () => {
    const h = await harness();
    expect(h.render()).toBe(true);
    h.writeBuffer.mockClear();
    h.draw.mockClear();
    h.domWork.mockClear();
    for (let index = 0; index < 100; index++) {
      h.damage();
      expect(h.render()).toBe(false);
    }
    expect(h.writeBuffer).not.toHaveBeenCalled();
    expect(h.draw).not.toHaveBeenCalled();
    expect(h.domWork).not.toHaveBeenCalled();
    h.cursor.x++;
    expect(h.render()).toBe(true);
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    expect(h.writeBuffer.mock.calls[0][2].byteLength).toBe(64);
  });

  it("uploads only the changed row and pauses text blinking in an unfocused window", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.cursor.visible = false;
    h.render();
    const cells = h.model.renderCells();
    cells.flags = () => CellFlags.BLINK;
    h.model.renderCells.mockReturnValue(cells);
    h.model.consumeDamage.mockReturnValueOnce({
      kind: "rows",
      ranges: [{ start: 2, end: 2 }],
    });
    h.writeBuffer.mockClear();
    expect(h.render()).toBe(true);
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    expect(h.writeBuffer.mock.calls[0][4]).toBe(120 * 64);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(600);
    h.render();
    h.surface.handleWindowFocus(false);
    h.render();
    expect(vi.getTimerCount()).toBe(0);
    h.schedule.mockClear();
    vi.advanceTimersByTime(6_000);
    expect(h.schedule).not.toHaveBeenCalled();
    h.surface.handleWindowFocus(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("redraws retained presentation after a short pause without repacking cells", async () => {
    const h = await harness();
    h.render();
    h.model.renderCells.mockClear();
    h.writeBuffer.mockClear();
    h.visibility(false, false);
    h.visibility(true, false);
    expect(h.render()).toBe(true);
    expect(h.model.renderCells).not.toHaveBeenCalled();
    expect(h.writeBuffer).not.toHaveBeenCalled();
  });

  it("stops cursor timers for an application-hidden cursor and unfocused window", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.cursor.blinking = true;
    h.surface.setFocused(true);
    h.render();
    expect(vi.getTimerCount()).toBe(1);
    h.cursor.visible = false;
    h.render();
    h.schedule.mockClear();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(6_000);
    expect(h.schedule).not.toHaveBeenCalled();
    h.cursor.visible = true;
    h.render();
    expect(vi.getTimerCount()).toBe(1);
    h.surface.handleWindowFocus(false);
    expect(vi.getTimerCount()).toBe(0);
    h.surface.handleWindowFocus(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("prioritizes wheel interaction without scheduling idle or hidden work", async () => {
    const h = await harness();
    h.schedule.mockClear();
    h.surface.eventTarget().dispatchEvent(new Event("wheel"));
    expect(h.interact).toHaveBeenCalledWith(h.surface);
    expect(h.schedule).not.toHaveBeenCalled();
    h.visibility(false, false);
    h.interact.mockClear();
    h.surface.eventTarget().dispatchEvent(new Event("wheel"));
    expect(h.interact).not.toHaveBeenCalled();
  });

  it("keeps pane pacing focused when the block command editor takes keyboard focus", async () => {
    const h = await harness();
    h.surface.setFocused(true);
    h.surface.inputElement().dispatchEvent(new Event("blur"));
    expect(h.surface.isFocused()).toBe(true);
    h.surface.setFocused(false);
    expect(h.surface.isFocused()).toBe(false);
  });

  it("does no DOM or presentation work for hidden output and retains fractional scrollbar positions", async () => {
    const h = await harness();
    h.position.history = 100;
    h.position.offset = 50;
    h.visibility(false, false);
    h.visibility(true, false);
    const scrollbar = h.elements.find(
      (element) => element.getAttribute("role") === "scrollbar",
    );
    if (!scrollbar) throw new Error("Missing terminal scrollbar");
    h.position.history += 1;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).not.toHaveBeenCalled();
    h.position.history -= 1;
    scrollbar.scrollTop = 800.25;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).not.toHaveBeenCalled();
    // Resuming synchronizes geometry but must not fight a native fractional scroll.
    h.visibility(false, false);
    h.visibility(true, false);
    expect(scrollbar.scrollTop).toBe(800.25);
    scrollbar.scrollTop = 820;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).toHaveBeenLastCalledWith(49);
    h.visibility(false, false);
    h.domWork.mockClear();
    h.schedule.mockClear();
    for (let index = 0; index < 1000; index++) h.damage();
    expect(h.domWork).not.toHaveBeenCalled();
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("reuses presentation through rapid desktop switches and retains selection after reclamation", async () => {
    const h = await harness();
    const allocated = h.createBuffer.mock.calls.length;
    for (let transition = 0; transition < 1_000; transition++) {
      h.visibility(false, false);
      h.visibility(true, false);
    }
    expect(h.createBuffer).toHaveBeenCalledTimes(allocated);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(h.model.releasePresentationResources).not.toHaveBeenCalled();
    h.visibility(false, true);
    expect(h.surface.diagnostics().gpuBufferBytes).toBe(0);
    expect(h.surface.diagnostics().estimatedSwapchainBytes).toBe(0);
    expect(h.model.releasePresentationResources).toHaveBeenCalledOnce();
    expect(h.surface.getSelection()).toBe("selected output");
    h.visibility(true, false);
    expect(h.createBuffer).toHaveBeenCalledTimes(allocated * 2);
    expect(h.surface.getSelection()).toBe("selected output");
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("defers font changes during occlusion and acquires the current font and DPR on resume", async () => {
    const h = await harness();
    const allocated = h.createBuffer.mock.calls.length;
    h.visibility(false, false);
    const metrics = {
      ...METRICS,
      cellWidth: 10,
      font: { ...METRICS.font, size: 18 },
    };
    h.surface.setFontMetrics(metrics);
    expect(h.createBuffer).toHaveBeenCalledTimes(allocated);
    expect(h.surface.diagnostics().gpuBufferBytes).toBe(0);
    window.devicePixelRatio = 2;
    h.visibility(true, false);
    expect(h.acquireGlyphAtlas).toHaveBeenLastCalledWith(metrics, 2, h.surface);
    expect(h.surface.diagnostics().gpuBufferBytes).toBeGreaterThan(0);
    expect(h.onError).not.toHaveBeenCalled();
  });
});

const METRICS = {
  font: {
    family: "monospace",
    size: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  cellWidth: 8,
  cellHeight: 16,
  baseline: 12,
};

async function harness() {
  bridge.visible = true;
  const destroy = vi.fn();
  const createBuffer = vi.fn(({ size }) => ({ size, destroy }));
  const context = { configure: vi.fn(), unconfigure: vi.fn() };
  const domWork = vi.fn();
  const elements: ReturnType<typeof createElement>[] = [];
  function createElement() {
    const attributes = new Map<string, string>();
    const value = Object.assign(new EventTarget(), {
      style: new Proxy(
        { setProperty: domWork },
        {
          set(target, property, value) {
            domWork();
            return Reflect.set(target, property, value);
          },
        },
      ),
      scrollTop: 0,
      width: 300,
      height: 150,
      clientHeight: 640,
      setAttribute: (name: string, value: string) => {
        domWork();
        attributes.set(name, value);
      },
      getAttribute: (name: string) => attributes.get(name),
      append: vi.fn(),
      appendChild: vi.fn(),
      remove: vi.fn(),
      getContext: () => context,
      getBoundingClientRect: () => {
        domWork();
        return { width: 960, height: 640 };
      },
    });
    return value;
  }
  const element = () => {
    const value = createElement();
    elements.push(value);
    return value;
  };
  vi.stubGlobal("document", { createElement: element });
  vi.stubGlobal("window", { devicePixelRatio: 1, setTimeout, clearTimeout });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 });
  const acquireGlyphAtlas = vi.fn(() => ({
    atlas: {
      generation: 1,
      coverageTextureView: {},
      colorTextureView: {},
      encodePendingUploads: vi.fn(),
    },
    release: vi.fn(),
  }));
  const schedule = vi.fn();
  const interact = vi.fn();
  const writeBuffer = vi.fn();
  const resources = {
    device: {
      createBuffer,
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer },
    },
    generation: 1,
  };
  bridge.runtime = {
    register: vi.fn(),
    unregister: vi.fn(),
    schedule,
    interact,
    acquireGlyphAtlas,
    resources: () => resources,
  };
  const position = { history: 0, offset: 0 };
  const cursor = { x: 0, y: 0, visible: true, blinking: false, style: "block" };
  let damage = () => {};
  const model = {
    cols: 120,
    rows: 40,
    cursor: () => cursor,
    deferPresentation: () => false,
    consumeDamage: vi.fn((): TerminalDamage => ({ kind: "none" })),
    viewportOriginLine: () => 0,
    renderCells: vi.fn(() => ({
      length: model.cols * model.rows,
      width: () => 1,
      flags: (): number => 0,
      codepoint: () => 0,
      backgroundPacked: () => 0,
      foregroundPacked: () => 0xffffff,
      underlineColorPacked: () => 0,
      overline: () => false,
    })),
    setCursorOptions: vi.fn(),
    revision: () => 0,
    subscribeDamage: (listener: () => void) => {
      damage = listener;
      return () => {};
    },
    trackedSelection: () => ({
      anchor: { line: 0, column: 0 },
      focus: { line: 0, column: 10 },
      rectangular: false,
    }),
    selectionText: () => "selected output",
    scrollPosition: () => position,
    scrollTo: vi.fn((offset: number) => {
      position.offset = offset;
      damage();
    }),
    modes: () => ({ alternateScreen: false }),
    setPixelSize: vi.fn(),
    releasePresentationResources: vi.fn(),
    resize: (cols: number, rows: number) => {
      model.cols = cols;
      model.rows = rows;
    },
  };
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  Object.assign(context, {
    getCurrentTexture: vi.fn(() => ({ createView: () => ({}) })),
  });
  const onError = vi.fn();
  const surface = await WebGpuTerminalSurface.create({
    model: model as unknown as GhosttyTerminalModelApi,
    metrics: METRICS,
    theme: {
      background: [0, 0, 0],
      foreground: [255, 255, 255],
      cursor: [255, 255, 255],
      selection: { color: [50, 50, 50], alpha: 0.5 },
      palette: [],
    },
    cursorBlink: false,
    cursorStyle: "block",
    onResize: vi.fn(),
    onError,
  });
  surfaces.push(surface);
  surface.attach(element() as unknown as HTMLElement);
  return {
    surface,
    cursor,
    writeBuffer,
    draw: pass.draw,
    render: () =>
      surface.renderFrame(
        encoder as unknown as GPUCommandEncoder,
        resources as never,
      ),
    model,
    position,
    domWork,
    schedule,
    interact,
    elements,
    damage: () => damage(),
    createBuffer,
    destroy,
    acquireGlyphAtlas,
    onError,
    visibility(visible: boolean, reclaim: boolean) {
      bridge.visible = visible;
      surface.handleVisibilityChange(visible, reclaim);
    },
  };
}
