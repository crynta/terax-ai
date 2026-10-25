import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import type { TerminalDamage } from "@/modules/terminal/backend/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GhosttyGpuFrame,
  GhosttyTerminalModelApi,
} from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import type { DeviceRect } from "@/modules/terminal/ghostty/gpu/PaneRects";
import {
  SCREEN_OFFSET,
  SCREEN_UNIFORM_BYTES,
} from "@/modules/terminal/ghostty/gpu/shaders";
import { WebGpuTerminalSurface } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalSurface";
import { deriveFontMetrics } from "@/modules/terminal/ghostty/gpu/terminalVisuals";
import { resetTerminalResizeGestureForTest } from "@/modules/terminal/lib/terminalResizeGesture";

const bridge = vi.hoisted(() => ({ runtime: {} as unknown, visible: true }));
vi.mock(
  "@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime")
    >()),
    getWebGpuTerminalRuntime: async () => bridge.runtime,
  }),
);
vi.mock("@/modules/terminal/ghostty/windowPresentation", () => ({
  terminalWindowPresentation: () => ({
    visible: bridge.visible,
    reclaim: false,
  }),
}));

const surfaces: WebGpuTerminalSurface[] = [];
afterEach(() => {
  resetTerminalResizeGestureForTest();
  for (const surface of surfaces.splice(0)) surface.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CELL = 16;

describe("WebGPU surface data path", () => {
  it("uploads dirty row ranges straight from the borrowed view before any other model call", async () => {
    const h = await harness();
    expect(h.render()).toBe(true);
    h.writeBuffer.mockClear();
    h.calls.length = 0;

    h.gpu.dirty([
      { start: 2, end: 2 },
      { start: 5, end: 6 },
    ]);
    expect(h.render()).toBe(true);

    const uploads = h.writeBuffer.mock.calls.filter(
      ([buffer]) => buffer === h.lastCellsBuffer(),
    );
    expect(
      uploads.map(([, offset, , dataOffset, size]) => [
        offset,
        dataOffset,
        size,
      ]),
    ).toEqual([
      [2 * 120 * CELL, 2 * 120 * CELL, 120 * CELL],
      [5 * 120 * CELL, 5 * 120 * CELL, 2 * 120 * CELL],
    ]);
    // The data argument is the very view the model returned: no copy.
    expect(uploads[0][2]).toBe(h.gpu.cells);
    // Nothing may touch the model between the frame and the uploads that
    // read its borrowed memory.
    const afterFrame = h.calls.slice(h.calls.indexOf("consumeGpuFrame") + 1);
    expect(afterFrame.slice(0, 2)).toEqual([
      "writeBuffer:cells",
      "writeBuffer:cells",
    ]);
  });

  it("does not upload, draw or touch the DOM for unchanged output", async () => {
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
  });

  it("uploads only the uniform for cursor movement and redraws", async () => {
    const h = await harness();
    h.render();
    h.writeBuffer.mockClear();
    h.cursor.x++;
    expect(h.render()).toBe(true);
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    expect(h.writeBuffer.mock.calls[0][0]).toBe(h.lastUniformBuffer());
    expect((h.writeBuffer.mock.calls[0][2] as Float32Array).byteLength).toBe(
      SCREEN_UNIFORM_BYTES,
    );
  });

  it("redraws whenever the frame reports damage even if no record changed", async () => {
    const h = await harness();
    h.render();
    h.draw.mockClear();
    h.gpu.damage = { kind: "rows", ranges: [{ start: 3, end: 3 }] };
    expect(h.render()).toBe(true);
    h.writeBuffer.mockClear();
    expect(h.render()).toBe(false);
  });

  it("never calls the structure-of-arrays model APIs", async () => {
    const h = await harness();
    h.render();
    h.gpu.dirty([{ start: 0, end: 39 }]);
    h.render();
    h.cursor.x++;
    h.render();
    expect(h.sparseApiCalls).toEqual([]);
    expect(h.model.renderCells).not.toHaveBeenCalled();
    expect(h.model.consumeDamage).not.toHaveBeenCalled();
  });

  it("asks for a full resync on first use and after resources are recreated", async () => {
    const h = await harness();
    h.render();
    expect(h.model.consumeGpuFrame).toHaveBeenLastCalledWith({ resync: true });
    h.render();
    expect(h.model.consumeGpuFrame).toHaveBeenLastCalledWith({ resync: false });
    // A pause keeps the uploaded cells, so nothing needs to be sent again.
    h.visibility(false);
    h.visibility(true);
    h.render();
    expect(h.model.consumeGpuFrame).toHaveBeenLastCalledWith({ resync: false });
    // Buffers rebuilt for a replacement device do.
    h.surface.handleDeviceLoss();
    h.visibility(true);
    h.render();
    expect(h.model.consumeGpuFrame).toHaveBeenLastCalledWith({ resync: true });
  });

  it("encodes one fullscreen triangle and one glyph instance per cell into the window pass", async () => {
    const h = await harness();
    h.render();
    const stats = h.surface.diagnostics();
    expect(h.surface.drawable()).toBe(true);
    h.encode();
    // Viewport and scissor belong to the window canvas; the pane only issues its draws.
    expect(h.pass.setViewport).not.toHaveBeenCalled();
    expect(h.pass.setScissorRect).not.toHaveBeenCalled();
    expect(h.pass.setPipeline).toHaveBeenNthCalledWith(
      1,
      h.resources.backgroundPipeline,
    );
    expect(h.pass.draw).toHaveBeenNthCalledWith(1, 3);
    expect(h.pass.setPipeline).toHaveBeenNthCalledWith(
      2,
      h.resources.glyphPipeline,
    );
    expect(h.pass.draw).toHaveBeenNthCalledWith(2, 6, stats.cols * stats.rows);
    expect(h.pass.setBindGroup).toHaveBeenCalledOnce();
  });

  it("prepares frames without touching the render pass, and cannot be drawn before its first frame", async () => {
    const h = await harness();
    expect(h.surface.drawable()).toBe(false);
    h.render();
    expect(h.pass.setBindGroup).not.toHaveBeenCalled();
    expect(h.draw).not.toHaveBeenCalled();
    expect(h.surface.drawable()).toBe(true);
  });
});

describe("glyph map", () => {
  it("rasterizes announced glyphs through the atlas and uploads one map range", async () => {
    const h = await harness();
    h.gpu.announce([
      { id: 1, style: 0, text: "a" },
      { id: 2, style: 1, text: "b" },
      { id: 3, style: 0, text: "😀" },
    ]);
    h.render();
    expect(h.atlas.resolve.mock.calls).toEqual([
      ["a", 0],
      ["b", 1],
      ["😀", 0],
    ]);
    expect(h.atlas.commit).toHaveBeenCalled();
    const mapWrite = h.writeBuffer.mock.calls.find(
      ([buffer]) => buffer === h.lastGlyphMapBuffer(),
    );
    if (!mapWrite) throw new Error("glyph map was not uploaded");
    const entries = (mapWrite[2] as Uint32Array).subarray(1, 4);
    expect([...entries]).toEqual([100, 101, 102]);
  });

  it("stays pending when the raster budget runs out and schedules a follow-up frame", async () => {
    const h = await harness();
    h.render();
    h.schedule.mockClear();
    h.gpu.announce(
      Array.from({ length: 50 }, (_, index) => ({
        id: index + 1,
        style: 0,
        text: String.fromCharCode(0x100 + index),
      })),
    );
    const budget = { exhausted: () => true };
    expect(h.render(budget)).toBe(true);
    expect(h.atlas.resolve).toHaveBeenCalledTimes(1);
    expect(h.surface.diagnostics().pendingGlyphs).toBe(49);
    expect(h.schedule).toHaveBeenCalledWith(h.surface);
    for (let frame = 0; frame < 49; frame++) h.render(budget);
    expect(h.surface.diagnostics().pendingGlyphs).toBe(0);
    h.schedule.mockClear();
    h.render(budget);
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("allows a larger budget on the first frame", async () => {
    const h = await harness();
    const allowances: Array<number | undefined> = [];
    h.gpu.announce([
      { id: 1, style: 0, text: "a" },
      { id: 2, style: 0, text: "b" },
    ]);
    h.render({
      exhausted: (allowance) => {
        allowances.push(allowance);
        return false;
      },
    });
    expect(allowances.every((value) => value === 8)).toBe(true);
    h.gpu.announce([
      { id: 3, style: 0, text: "c" },
      { id: 4, style: 0, text: "d" },
    ]);
    allowances.length = 0;
    h.render({
      exhausted: (allowance) => {
        allowances.push(allowance);
        return false;
      },
    });
    expect(allowances.every((value) => value === undefined)).toBe(true);
  });

  it("drops its mapping on a new Ghostty epoch", async () => {
    const h = await harness();
    h.gpu.announce([{ id: 1, style: 0, text: "a" }]);
    h.render();
    h.atlas.resolve.mockClear();
    h.gpu.epoch += 1;
    h.gpu.table = [{ id: 1, style: 0, text: "z" }];
    h.gpu.announce([{ id: 1, style: 0, text: "z" }]);
    h.render();
    expect(h.atlas.resolve).toHaveBeenCalledExactlyOnceWith("z", 0);
  });

  it("recovers after an atlas flush by resyncing and mapping only visible glyphs", async () => {
    const h = await harness();
    h.gpu.announce([
      { id: 1, style: 0, text: "a" },
      { id: 2, style: 0, text: "b" },
    ]);
    // Only glyph 2 is visible.
    h.gpu.setCell(0, 2);
    h.render();
    h.model.consumeGpuFrame.mockClear();
    h.atlas.resolve.mockClear();

    h.atlas.epoch += 1;
    h.atlas.nextIndex = 0;
    h.render();
    expect(h.model.consumeGpuFrame).toHaveBeenLastCalledWith({ resync: true });
    expect(h.atlas.resolve.mock.calls.map(([text]) => text)).toEqual(["b"]);
    expect(h.surface.diagnostics().pendingGlyphs).toBe(0);
  });

  it("rebuilds the bind group when the atlas replaces a texture", async () => {
    const h = await harness();
    h.render();
    h.createBindGroup.mockClear();
    h.atlas.generation += 1;
    h.gpu.damage = { kind: "rows", ranges: [{ start: 0, end: 0 }] };
    expect(h.render()).toBe(true);
    expect(h.createBindGroup).toHaveBeenCalledOnce();
  });

  it("reports a full atlas to its lease without spinning frames", async () => {
    const h = await harness();
    h.render();
    h.schedule.mockClear();
    h.atlas.full = true;
    h.gpu.announce([{ id: 1, style: 0, text: "a" }]);
    h.render();
    expect(h.lease.requestFlush).toHaveBeenCalledOnce();
    expect(h.schedule).not.toHaveBeenCalled();
  });
});

describe("search mask", () => {
  it("exists only while a search highlights cells and uploads only when it changes", async () => {
    const h = await harness();
    h.render();
    const searchBuffers = () =>
      h.createBuffer.mock.calls.filter(([descriptor]) =>
        descriptor.label?.includes("search"),
      );
    expect(searchBuffers()).toHaveLength(0);

    h.setMask([1, 1, 0, 0, 2]);
    h.writeBuffer.mockClear();
    expect(h.render()).toBe(true);
    expect(searchBuffers()).toHaveLength(1);
    const upload = h.writeBuffer.mock.calls.find(([buffer]) =>
      (buffer as { label?: string }).label?.includes("search"),
    );
    if (!upload) throw new Error("search mask was not uploaded");
    expect((upload[2] as Uint8Array).byteLength).toBe(8);

    h.writeBuffer.mockClear();
    for (let index = 0; index < 20; index++) h.damage();
    expect(h.render()).toBe(false);
    expect(h.writeBuffer).not.toHaveBeenCalled();

    h.setMask(null);
    expect(h.render()).toBe(true);
    expect(h.lastSearchBuffer()?.destroy).toHaveBeenCalled();
  });
});

describe("selection", () => {
  it("does not open a hyperlink when releasing a text selection over it", async () => {
    const h = await harness();
    Object.assign(h.model, {
      hyperlinkAtViewportCell: () => "https://example.test",
    });
    const pointer = (type: string) =>
      h.surface.eventTarget().dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), {
          button: 0,
          clientX: 12,
          clientY: 12,
          shiftKey: false,
        }),
      );
    pointer("mousedown");
    pointer("mouseup");
    expect(h.onOpenLink).not.toHaveBeenCalled();
    Object.assign(h.model, { trackedSelection: () => null });
    h.surface.getSelection();
    pointer("mousedown");
    pointer("mouseup");
    expect(h.onOpenLink).toHaveBeenCalledWith("https://example.test");
  });
  it("redraws through its uniform when the viewport origin shifts", async () => {
    const h = await harness();
    h.render();
    h.writeBuffer.mockClear();
    h.origin = 1;
    expect(h.render()).toBe(true);
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    expect(h.writeBuffer.mock.calls[0][0]).toBe(h.lastUniformBuffer());
  });
});

describe("pixel-exact geometry", () => {
  it.each([1, 1.25, 1.5, 1.75, 2, 2.25, 3])(
    "fits whole device cells and keeps CSS and device cell sizes 1:1 at %s",
    async (scale) => {
      const h = await harness({ scale });
      h.render();
      const stats = h.surface.diagnostics();
      expect(h.surface.cellSize().width * scale).toBeCloseTo(
        stats.deviceCellWidth,
        9,
      );
      expect(h.surface.cellSize().height * scale).toBeCloseTo(
        stats.deviceCellHeight,
        9,
      );
      expect(h.onResize).toHaveBeenCalledWith(stats.cols, stats.rows);
      expect(h.model.setPixelSize).toHaveBeenCalledWith(
        stats.cols * stats.deviceCellWidth,
        stats.rows * stats.deviceCellHeight,
      );
      // The grid fits the host in whole cells.
      expect(stats.cols * stats.deviceCellWidth).toBeLessThanOrEqual(
        Math.round(960 * scale),
      );
    },
  );

  it("uses the engine's device-pixel content box when it is reported", async () => {
    const h = await harness({ scale: 1.25 });
    h.render();
    const before = h.surface.diagnostics().cols;
    const deviceWidth = before * h.surface.diagnostics().deviceCellWidth - 1;
    h.observe({
      width: 700,
      height: 500,
      device: { width: deviceWidth, height: 625 },
      left: 10,
      top: 20,
    });
    h.render();
    expect(h.surface.diagnostics().cols).toBe(before - 1);
  });

  it("tells the window canvas where its host is on every layout change, and packs the rectangle it gets back", async () => {
    const h = await harness({ scale: 1.25 });
    h.render();
    expect(h.setBounds).toHaveBeenLastCalledWith({
      left: 0,
      top: 0,
      width: 960,
      height: 640,
    });
    h.observe({ width: 700, height: 500, left: 100.4, top: 20 });
    expect(h.setBounds).toHaveBeenLastCalledWith({
      left: 100.4,
      top: 20,
      width: 700,
      height: 500,
    });

    // The canvas answers with the snapped device rectangle; the uniform carries it.
    h.paneRect.value = { x: 126, y: 25, width: 875, height: 625 };
    h.writeBuffer.mockClear();
    expect(h.render()).toBe(true);
    const uniform = h.writeBuffer.mock.calls.find(
      ([buffer]) => buffer === h.lastUniformBuffer(),
    );
    if (!uniform) throw new Error("uniform was not uploaded");
    const words = new Uint32Array((uniform[2] as Float32Array).buffer);
    const floats = uniform[2] as Float32Array;
    expect([
      floats[SCREEN_OFFSET.viewportSize / 4],
      floats[SCREEN_OFFSET.viewportSize / 4 + 1],
    ]).toEqual([875, 625]);
    expect([
      words[SCREEN_OFFSET.origin / 4],
      words[SCREEN_OFFSET.origin / 4 + 1],
    ]).toEqual([126, 25]);
  });

  it("redraws, without touching the grid, when only the pane's rectangle moved", async () => {
    const h = await harness();
    h.render();
    h.paneRect.value = { x: 4, y: 0, width: 956, height: 640 };
    h.writeBuffer.mockClear();
    h.model.consumeGpuFrame.mockClear();
    expect(h.render()).toBe(true);
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    expect(h.writeBuffer.mock.calls[0][0]).toBe(h.lastUniformBuffer());
    // A moved rectangle alone leaves the PTY alone.
    expect(h.onResize).toHaveBeenCalledTimes(1);
  });

  it("re-measures the font and rebuilds resources when the display ratio changes", async () => {
    const h = await harness({ scale: 1 });
    h.render();
    const before = h.surface.diagnostics();
    h.setScale(1.5);
    h.dprChange();
    const after = h.surface.diagnostics();
    expect(after.scale).toBe(1.5);
    expect(after.deviceCellWidth).toBe(12);
    expect(h.acquireGlyphAtlas).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: 1.5, deviceCellWidth: 12 }),
      h.surface,
    );
    expect(after.cols).toBeGreaterThan(before.cols * 0);
    expect(h.render()).toBe(true);
    expect(h.surface.drawable()).toBe(true);
    h.encode();
    expect(h.pass.draw).toHaveBeenLastCalledWith(6, after.cols * after.rows);
  });
});

describe("resizing the host", () => {
  const ORIGIN = { left: 0, top: 0 };
  const hostSize = (width: number, height = 640) => ({
    width,
    height,
    ...ORIGIN,
  });

  it("leaves the model and the PTY alone during a gesture and applies the final size once at its end", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    const first = h.surface.diagnostics();
    h.onResize.mockClear();
    h.model.setPixelSize.mockClear();

    const token = {};
    beginTerminalResizeInteraction(token);
    // A drag: a new host width every 16 ms for a second, a frame after each.
    for (let step = 1; step <= 62; step++) {
      h.observe(hostSize(960 - step * 8));
      h.render();
      vi.advanceTimersByTime(16);
      h.render();
      // The pane's rectangle follows the host at once ...
      expect(h.setBounds).toHaveBeenLastCalledWith(
        expect.objectContaining({ width: 960 - step * 8 }),
      );
    }
    // ... while neither the grid nor the shell heard about any of it.
    expect(h.onResize).not.toHaveBeenCalled();
    expect(h.model.setPixelSize).not.toHaveBeenCalled();
    expect(h.surface.diagnostics().cols).toBe(first.cols);
    expect(h.surface.diagnostics().deferredGridResizes).toBeGreaterThan(30);

    endTerminalResizeInteraction(token);
    // The burst detector of the observer is quiet 150 ms after the last change.
    vi.advanceTimersByTime(200);
    h.render();

    // One synchronized resize at the final size.
    expect(h.onResize).toHaveBeenCalledOnce();
    const last = h.surface.diagnostics();
    expect(last.cols).toBe(Math.floor((960 - 62 * 8) / 8));
    expect(h.onResize).toHaveBeenCalledWith(last.cols, last.rows);
    expect(last.cols).toBeLessThan(first.cols);
  });

  it("moves the grid up inside a shorter pane so the cursor row stays visible, only while the gesture lasts", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    const shift = () => {
      h.writeBuffer.mockClear();
      h.render();
      const upload = h.writeBuffer.mock.calls.find(
        ([buffer]) => buffer === h.lastUniformBuffer(),
      );
      if (!upload) return null;
      return new Uint32Array((upload[2] as Float32Array).buffer)[
        SCREEN_OFFSET.shiftY / 4
      ];
    };
    const { rows, deviceCellHeight } = h.surface.diagnostics();

    const token = {};
    beginTerminalResizeInteraction(token);
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 400 };
    h.observe(hostSize(960, 400));
    // The prompt is on the last row: the grid moves up by what the pane lost.
    h.cursor.y = rows - 1;
    expect(shift()).toBe(rows * deviceCellHeight - 400);
    // A cursor near the top is already visible: top-anchored, nothing moves.
    h.cursor.y = 2;
    h.observe(hostSize(960, 399));
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 399 };
    expect(shift()).toBe(0);
    // A taller pane than the grid pads at the bottom instead.
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 900 };
    h.observe(hostSize(960, 900));
    expect(shift()).toBe(0);

    h.cursor.y = rows - 1;
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 400 };
    h.observe(hostSize(960, 400));
    expect(shift()).toBe(rows * deviceCellHeight - 400);
    endTerminalResizeInteraction(token);
    vi.advanceTimersByTime(200);
    // The final fit follows the pane; at rest nothing is shifted any more.
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 400 };
    expect(shift()).toBe(0);
  });

  it("does not resize at all when the gesture ends at the size it started with", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    h.onResize.mockClear();

    const token = {};
    beginTerminalResizeInteraction(token);
    h.observe(hostSize(600));
    h.render();
    h.observe(hostSize(960));
    h.render();
    endTerminalResizeInteraction(token);
    vi.advanceTimersByTime(200);
    h.render();

    expect(h.onResize).not.toHaveBeenCalled();
  });

  it("applies every non-gesture fit immediately and in step with the PTY", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    h.onResize.mockClear();

    h.observe(hostSize(800));
    h.render();
    expect(h.onResize).toHaveBeenCalledTimes(1);
    // The model already has the size the PTY is told about.
    expect(h.surface.diagnostics().cols).toBe(100);

    // A font change is not a gesture and is never held back.
    h.surface.setFontMetrics({
      ...METRICS,
      deviceCellWidth: 10,
      cellWidth: 10,
    });
    expect(h.onResize).toHaveBeenCalledTimes(2);
    expect(h.surface.diagnostics().cols).toBe(80);
  });

  it("treats a burst of host changes as a gesture and lands the last size when it is quiet", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    h.observe(hostSize(900));
    h.render();
    h.onResize.mockClear();

    // A second change within 150 ms of the first starts the burst.
    vi.advanceTimersByTime(10);
    h.observe(hostSize(640));
    h.render();
    vi.advanceTimersByTime(100);
    h.observe(hostSize(560));
    h.render();
    expect(h.onResize).not.toHaveBeenCalled();
    expect(h.surface.diagnostics().cols).toBe(112);

    // 150 ms without a host change ends it.
    vi.advanceTimersByTime(200);
    h.render();

    expect(h.onResize).toHaveBeenCalledOnce();
    expect(h.surface.diagnostics().cols).toBe(70);
  });
});

describe("WebGPU surface resource lifecycle", () => {
  it("uploads only the changed row and pauses text blinking in an unfocused window", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.cursor.visible = false;
    h.render();
    h.gpu.blinking = 3;
    h.gpu.dirty([{ start: 2, end: 2 }]);
    h.writeBuffer.mockClear();
    expect(h.render()).toBe(true);
    expect(
      h.writeBuffer.mock.calls.filter(
        ([buffer]) => buffer === h.lastCellsBuffer(),
      ),
    ).toHaveLength(1);
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

  it("arms the text blink timer only while cells blink", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.cursor.visible = false;
    h.render();
    expect(vi.getTimerCount()).toBe(0);
    h.gpu.blinking = 1;
    h.gpu.dirty([{ start: 0, end: 0 }]);
    h.render();
    expect(vi.getTimerCount()).toBe(1);
    h.gpu.blinking = 0;
    h.gpu.dirty([{ start: 0, end: 0 }]);
    h.render();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("redraws retained presentation after a short pause without re-uploading cells", async () => {
    const h = await harness();
    h.render();
    h.model.consumeGpuFrame.mockClear();
    h.writeBuffer.mockClear();
    h.visibility(false);
    h.visibility(true);
    expect(h.render()).toBe(true);
    expect(h.model.consumeGpuFrame).toHaveBeenLastCalledWith({ resync: false });
    expect(
      h.writeBuffer.mock.calls.filter(
        ([buffer]) => buffer === h.lastCellsBuffer(),
      ),
    ).toHaveLength(0);
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
    h.visibility(false);
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
    h.visibility(false);
    h.visibility(true);
    const scrollbar = h.elements.find(
      (element) => element.getAttribute("role") === "scrollbar",
    );
    if (!scrollbar) throw new Error("Missing terminal scrollbar");
    h.position.history += 1;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).not.toHaveBeenCalled();
    h.position.history -= 1;
    const line = h.surface.cellSize().height;
    scrollbar.scrollTop = 50 * line + 0.25;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).not.toHaveBeenCalled();
    // Resuming synchronizes geometry but must not fight a native fractional scroll.
    h.visibility(false);
    h.visibility(true);
    h.render();
    expect(scrollbar.scrollTop).toBe(50 * line + 0.25);
    scrollbar.scrollTop = 51 * line;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).toHaveBeenLastCalledWith(49);
    h.visibility(false);
    h.domWork.mockClear();
    h.schedule.mockClear();
    for (let index = 0; index < 1000; index++) h.damage();
    expect(h.domWork).not.toHaveBeenCalled();
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("does not take the browser clamping its own scroll write for the user scrolling up", async () => {
    // Ghostty prunes whole pages of scrollback, so the history can shrink by hundreds of lines
    // under a bottom-pinned view. The browser clamps the thumb to the shorter content and
    // reports a scroll event for a position the surface did not write; read as a drag, with the
    // history one line longer by then, it moved the model one line above the bottom and left the
    // view anchored there while output streamed on (the pane stopped changing on screen).
    const h = await harness();
    h.position.history = 1_028;
    h.position.offset = 0;
    h.render();
    const scrollbar = h.elements.find(
      (element) => element.getAttribute("role") === "scrollbar",
    ) as unknown as {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      dispatchEvent(event: Event): boolean;
    };
    const line = h.surface.cellSize().height;
    expect(scrollbar.scrollTop).toBe(1_028 * line);
    h.position.history = 494;
    h.render();
    h.position.history = 495;
    scrollbar.scrollHeight = scrollbar.clientHeight + 494 * line;
    scrollbar.scrollTop = 494 * line;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).not.toHaveBeenCalled();
    // A real drag (here to the top) is still honoured.
    scrollbar.scrollTop = 0;
    scrollbar.dispatchEvent(new Event("scroll"));
    expect(h.model.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("reads no layout on presented frames while history grows", async () => {
    const h = await harness();
    h.position.history = 10;
    h.position.offset = 0;
    h.render();
    h.scrollReads.mockClear();
    h.rectReads.mockClear();
    for (let frame = 0; frame < 100; frame++) {
      h.position.history += 1;
      h.gpu.dirty([{ start: 39, end: 39 }]);
      h.render();
    }
    expect(h.scrollReads).not.toHaveBeenCalled();
    expect(h.rectReads).not.toHaveBeenCalled();
  });

  it("pauses through rapid desktop switches and long occlusion without releasing anything", async () => {
    const h = await harness();
    h.render();
    const allocated = h.createBuffer.mock.calls.length;
    const resources = h.surface.diagnostics();
    for (let transition = 0; transition < 1_000; transition++) {
      h.visibility(false);
      h.visibility(true);
    }
    // A long occlusion is the same pause: nothing is destroyed, shrunk or unconfigured.
    h.visibility(false);
    expect(h.createBuffer).toHaveBeenCalledTimes(allocated);
    expect(h.destroy).not.toHaveBeenCalled();
    expect(h.model.releasePresentationResources).not.toHaveBeenCalled();
    // The pane stays in the window canvas for the whole pause.
    expect(h.register).toHaveBeenCalledOnce();
    expect(h.unregister).not.toHaveBeenCalled();
    expect(h.surface.diagnostics()).toMatchObject({
      gpuBufferBytes: resources.gpuBufferBytes,
      documentSuspended: true,
    });
    expect(h.render()).toBe(false);
    expect(h.surface.getSelection()).toBe("selected output");
    h.visibility(true);
    expect(h.createBuffer).toHaveBeenCalledTimes(allocated);
    expect(h.render()).toBe(true);
    expect(h.surface.getSelection()).toBe("selected output");
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("keeps its place in the window canvas when the GPU device is lost and rebuilds its buffers for the replacement", async () => {
    const h = await harness();
    h.render();
    h.surface.handleDeviceLoss();
    expect(h.surface.diagnostics()).toMatchObject({
      gpuBufferBytes: 0,
      documentSuspended: true,
    });
    expect(h.destroy).toHaveBeenCalled();
    expect(h.surface.drawable()).toBe(false);
    expect(h.unregister).not.toHaveBeenCalled();

    h.resources.generation = 2;
    h.visibility(true);
    expect(h.register).toHaveBeenCalledOnce();
    expect(h.surface.diagnostics().gpuBufferBytes).toBeGreaterThan(0);
    expect(h.render()).toBe(true);
    expect(h.surface.drawable()).toBe(true);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("leaves the window canvas when hidden and rejoins it, without a canvas of its own, when shown", async () => {
    const h = await harness();
    h.render();
    expect(h.register).toHaveBeenCalledOnce();
    h.surface.setVisible(false);
    expect(h.unregister).toHaveBeenCalledOnce();
    expect(h.surface.drawable()).toBe(false);
    h.surface.setVisible(true);
    expect(h.register).toHaveBeenCalledTimes(2);
    expect(h.register).toHaveBeenLastCalledWith(h.surface, h.host);
  });

  it("keeps its DOM background until the window canvas has shown its first frame", async () => {
    const h = await harness();
    const root = h.elements.find(
      (e) => e.getAttribute("data-terax-ghostty-surface") === "webgpu",
    ) as unknown as { style: { backgroundColor: string } };
    expect(root.style.backgroundColor).toBe("rgb(0 0 0)");
    h.render();
    expect(root.style.backgroundColor).toBe("rgb(0 0 0)");
    h.surface.handleCanvasRevealed();
    expect(root.style.backgroundColor).toBe("transparent");
    // Leaving the window covers the canvas again until the next first frame.
    h.surface.setVisible(false);
    expect(root.style.backgroundColor).toBe("rgb(0 0 0)");
    h.surface.setVisible(true);
    h.render();
    expect(root.style.backgroundColor).toBe("rgb(0 0 0)");
  });

  it("shows the previous frame in the pane's moved rectangle while presentation is held", async () => {
    const h = await harness();
    h.render();
    h.model.deferPresentation = () => true;
    h.paneRect.value = { x: 40, y: 0, width: 920, height: 640 };
    h.writeBuffer.mockClear();
    h.model.consumeGpuFrame.mockClear();
    // The grid and cells of the last frame stay; only the uniform follows the rectangle.
    expect(h.render()).toBe(true);
    expect(h.model.consumeGpuFrame).not.toHaveBeenCalled();
    expect(h.writeBuffer).toHaveBeenCalledOnce();
    expect(h.writeBuffer.mock.calls[0][0]).toBe(h.lastUniformBuffer());
    expect(h.surface.drawable()).toBe(true);
    // Unchanged rectangle while held: nothing to draw.
    h.writeBuffer.mockClear();
    expect(h.render()).toBe(false);
    expect(h.writeBuffer).not.toHaveBeenCalled();
  });

  it("defers font changes during occlusion and acquires the current font and DPR on resume", async () => {
    const h = await harness();
    const allocated = h.createBuffer.mock.calls.length;
    h.visibility(false);
    h.surface.setFontMetrics({
      ...METRICS,
      deviceCellWidth: 10,
      cellWidth: 10,
      font: { ...METRICS.font, size: 18 },
    });
    expect(h.createBuffer).toHaveBeenCalledTimes(allocated);
    expect(h.surface.diagnostics().gpuBufferBytes).toBe(0);
    h.setScale(2);
    h.visibility(true);
    expect(h.acquireGlyphAtlas).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scale: 2,
        font: expect.objectContaining({ size: 18 }),
      }),
      h.surface,
    );
    expect(h.surface.diagnostics().gpuBufferBytes).toBeGreaterThan(0);
    expect(h.onError).not.toHaveBeenCalled();
  });
});

describe("shared atlas growth", () => {
  it("is not drawable once another pane replaced an atlas resource, until it rebinds", async () => {
    const h = await harness();
    h.render();
    expect(h.surface.drawable()).toBe(true);
    h.createBindGroup.mockClear();
    // Another pane grew the shared atlas: the table and textures this pane's bind group names
    // are retired and destroyed when the frame completes.
    h.atlas.generation += 1;
    expect(h.surface.drawable()).toBe(false);
    // The runtime rebinds every user after all panes prepared, without any upload.
    h.writeBuffer.mockClear();
    h.surface.rebindAtlas(h.resources as never);
    expect(h.createBindGroup).toHaveBeenCalledOnce();
    expect(h.writeBuffer).not.toHaveBeenCalled();
    expect(h.surface.drawable()).toBe(true);
    // Already current: nothing is created again.
    h.surface.rebindAtlas(h.resources as never);
    expect(h.createBindGroup).toHaveBeenCalledOnce();
  });

  it("leaves a pane without bindings of its own to its next prepared frame", async () => {
    const h = await harness();
    h.surface.rebindAtlas(h.resources as never);
    expect(h.createBindGroup).not.toHaveBeenCalled();
    h.render();
    h.surface.handleDeviceLoss();
    h.atlas.generation += 1;
    h.surface.rebindAtlas(h.resources as never);
    expect(h.createBindGroup).toHaveBeenCalledOnce();
  });
});

describe("a resize gesture ending in a prompt redraw hold", () => {
  const hostSize = (width: number, height = 640) => ({
    width,
    height,
    left: 0,
    top: 0,
  });
  const holdPresentation = (
    h: Awaited<ReturnType<typeof harness>>,
    held: boolean,
  ) => {
    h.model.presentationSuppressed = () => held;
    h.model.deferPresentation = () => held;
  };
  const uploadedShift = (h: Awaited<ReturnType<typeof harness>>) => {
    h.writeBuffer.mockClear();
    h.render();
    const upload = h.writeBuffer.mock.calls.find(
      ([buffer]) => buffer === h.lastUniformBuffer(),
    );
    if (!upload) return null;
    return new Uint32Array((upload[2] as Float32Array).buffer)[
      SCREEN_OFFSET.shiftY / 4
    ];
  };

  it("does not replace the cell buffer while presentation is held, so the pane keeps drawing", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    const token = {};
    beginTerminalResizeInteraction(token);
    h.paneRect.value = { x: 0, y: 0, width: 200, height: 160 };
    h.observe(hostSize(200, 160));
    h.render();
    endTerminalResizeInteraction(token);
    vi.advanceTimersByTime(200);
    // The resize cleared the prompt: the previous frame stays on screen until the redraw.
    holdPresentation(h, true);
    const buffers = h.createBuffer.mock.calls.length;
    h.render();
    expect(h.surface.diagnostics().cellCompactions).toBe(0);
    expect(h.createBuffer).toHaveBeenCalledTimes(buffers);
    expect(h.surface.drawable()).toBe(true);
    expect(h.model.compactPresentationResources).not.toHaveBeenCalled();
    // The redraw ended: the frame that shows it compacts, and the pane is drawable again at
    // the end of that very frame.
    holdPresentation(h, false);
    h.render();
    expect(h.surface.diagnostics().cellCompactions).toBe(1);
    expect(h.model.compactPresentationResources).toHaveBeenCalledOnce();
    expect(h.surface.drawable()).toBe(true);
  });

  it("keeps the grid shifted up inside the held frame, clamped to what the rectangle still lacks", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    const { rows, deviceCellHeight } = h.surface.diagnostics();
    const grid = rows * deviceCellHeight;
    const token = {};
    beginTerminalResizeInteraction(token);
    h.cursor.y = rows - 1;
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 400 };
    h.observe(hostSize(960, 400));
    expect(uploadedShift(h)).toBe(grid - 400);
    endTerminalResizeInteraction(token);
    vi.advanceTimersByTime(200);
    holdPresentation(h, true);
    h.render();
    // The final layout lands while the old frame is held: it used to snap to the top rows
    // (shift 0) and cut off the prompt at the bottom.
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 420 };
    expect(uploadedShift(h)).toBe(grid - 420);
    // A rectangle that is lacking more keeps the shift it had; one that is tall enough needs none.
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 380 };
    expect(uploadedShift(h)).toBe(grid - 420);
    h.paneRect.value = { x: 0, y: 0, width: 960, height: grid + 50 };
    expect(uploadedShift(h)).toBe(0);
  });

  it("tells hit-testing how far the drawn grid is moved up, in CSS pixels", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.render();
    vi.advanceTimersByTime(500);
    expect(h.surface.gridShiftY()).toBe(0);
    const { rows, deviceCellHeight } = h.surface.diagnostics();
    const token = {};
    beginTerminalResizeInteraction(token);
    h.cursor.y = rows - 1;
    h.paneRect.value = { x: 0, y: 0, width: 960, height: 400 };
    h.observe(hostSize(960, 400));
    h.render();
    expect(h.surface.gridShiftY()).toBe(rows * deviceCellHeight - 400);
    endTerminalResizeInteraction(token);
    vi.advanceTimersByTime(200);
    h.render();
    expect(h.surface.gridShiftY()).toBe(0);
  });
});

describe("failure paths", () => {
  const root = (h: Awaited<ReturnType<typeof harness>>) =>
    h.elements.find(
      (e) => e.getAttribute("data-terax-ghostty-surface") === "webgpu",
    ) as unknown as { style: { backgroundColor: string } };

  it("covers the canvas with its own background when the runtime fails, until the fallback takes over", async () => {
    const h = await harness();
    h.render();
    h.surface.handleCanvasRevealed();
    expect(root(h).style.backgroundColor).toBe("transparent");
    // The window canvas is removed with the runtime; a transparent pane would show nothing.
    const error = new Error("WebGPU validation error");
    h.surface.handleRuntimeError(error);
    expect(root(h).style.backgroundColor).toBe("rgb(0 0 0)");
    expect(h.onError).toHaveBeenCalledWith(error);
  });

  it("covers the canvas while the device is replaced and is revealed again by the first frame after it", async () => {
    const h = await harness();
    h.render();
    h.surface.handleCanvasRevealed();
    // Reconfiguring the canvas for the replacement device clears it.
    h.surface.handleDeviceLoss();
    expect(root(h).style.backgroundColor).toBe("rgb(0 0 0)");
    h.resources.generation = 2;
    h.visibility(true);
    h.render();
    expect(root(h).style.backgroundColor).toBe("rgb(0 0 0)");
    h.surface.handleCanvasRevealed();
    expect(root(h).style.backgroundColor).toBe("transparent");
  });
});

const FONT = {
  family: "monospace",
  size: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  weight: "400",
} as const;
const METRICS = deriveFontMetrics(FONT, 1, {
  advance: 8,
  ascent: 12,
  descent: 4,
});

type FakeFrameState = {
  epoch: number;
  table: Array<{ id: number; style: number; text: string }>;
  announced: Array<{ id: number; style: number; text: string }>;
  dirtyRanges: Array<{ start: number; end: number }>;
  damage: TerminalDamage;
  blinking: number;
  cells: Uint8Array;
  dirty(ranges: Array<{ start: number; end: number }>): void;
  announce(glyphs: Array<{ id: number; style: number; text: string }>): void;
  setCell(index: number, glyph: number): void;
};

async function harness(options: { scale?: number } = {}) {
  let scale = options.scale ?? 1;
  bridge.visible = true;
  const destroy = vi.fn();
  const buffers: Array<{ size: number; label?: string; destroy: () => void }> =
    [];
  const createBuffer = vi.fn((descriptor: GPUBufferDescriptor) => {
    const buffer = {
      size: descriptor.size,
      label: descriptor.label,
      destroy: vi.fn(destroy),
    };
    buffers.push(buffer);
    return buffer;
  });
  const domWork = vi.fn();
  const scrollReads = vi.fn();
  const rectReads = vi.fn();
  const elements: ReturnType<typeof createElement>[] = [];
  function createElement() {
    const attributes = new Map<string, string>();
    let scrollTop = 0;
    const value = Object.assign(new EventTarget(), {
      style: new Proxy({ setProperty: domWork } as Record<string, unknown>, {
        set(target, property, next) {
          domWork();
          target[property as string] = next;
          return true;
        },
      }) as unknown as CSSStyleDeclaration,
      get scrollTop() {
        scrollReads();
        return scrollTop;
      },
      set scrollTop(next: number) {
        scrollTop = next;
      },
      width: 300,
      height: 150,
      clientHeight: 640,
      setAttribute: (name: string, next: string) => {
        domWork();
        attributes.set(name, next);
      },
      getAttribute: (name: string) => attributes.get(name),
      append: vi.fn(),
      appendChild: vi.fn(),
      remove: vi.fn(),
      contains: () => false,
      getContext: () => null,
      getBoundingClientRect: () => {
        rectReads();
        domWork();
        return { width: 960, height: 640, left: 0, top: 0 };
      },
    });
    return value;
  }
  const element = () => {
    const value = createElement();
    elements.push(value);
    return value;
  };
  const measure = () => ({
    font: "",
    measureText() {
      const size = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? "14");
      return {
        width: size * (8 / 14),
        actualBoundingBoxAscent: size * (12 / 14),
        actualBoundingBoxDescent: size * (4 / 14),
      };
    },
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      const made = element();
      // The pool's canvases and the font measurer share this stub.
      if (tag === "canvas") {
        Object.assign(made, {
          tagName: "CANVAS",
          getContext: (kind: string) => (kind === "2d" ? measuring : null),
        });
      }
      return made;
    },
  });
  const measuring = measure();
  let dprListener: (() => void) | null = null;
  const windowStub = {
    get devicePixelRatio() {
      return scale;
    },
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: { getItem: () => null },
    matchMedia: () => ({
      addEventListener: (_name: string, listener: () => void) => {
        dprListener = listener;
      },
      removeEventListener: vi.fn(),
    }),
  };
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh)" });
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
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });

  const calls: string[] = [];
  const sparseApiCalls: string[] = [];
  const gpu = createFrameState(120, 40);
  let nextIndex = 100;
  const atlas = {
    epoch: 1,
    generation: 1,
    full: false,
    get nextIndex() {
      return nextIndex;
    },
    set nextIndex(value: number) {
      nextIndex = value;
    },
    coverageTextureView: {},
    colorTextureView: {},
    tableBuffer: { size: 16 },
    resolve: vi.fn((_text: string, _style: number) =>
      atlas.full ? -1 : nextIndex++,
    ),
    commit: vi.fn(),
  };
  const lease = { atlas, requestFlush: vi.fn(), release: vi.fn() };
  const acquireGlyphAtlas = vi.fn(() => lease);
  const schedule = vi.fn();
  const interact = vi.fn();
  const writeBuffer = vi.fn((buffer: unknown, ..._rest: unknown[]) => {
    const label = (buffer as { label?: string }).label;
    calls.push(
      `writeBuffer:${label?.includes("cell records") ? "cells" : "other"}`,
    );
  });
  const createBindGroup = vi.fn(() => ({}));
  const resources = {
    device: {
      createBuffer,
      createBindGroup,
      queue: { writeBuffer },
    },
    generation: 1,
    format: "bgra8unorm" as GPUTextureFormat,
    bindGroupLayout: {},
    emptyStorage: { size: 16 },
    backgroundPipeline: { name: "background" },
    glyphPipeline: { name: "glyph" },
  };
  // What the window canvas gives a pane: the rectangle it computed, and a way to report layout.
  const paneRect: { value: DeviceRect | null } = {
    value: {
      x: 0,
      y: 0,
      width: Math.round(960 * scale),
      height: Math.round(640 * scale),
    },
  };
  const setBounds = vi.fn();
  const invalidate = vi.fn();
  const register = vi.fn((_surface: unknown, _host: unknown) => ({
    setBounds,
    rect: () => paneRect.value,
    invalidate,
  }));
  const unregister = vi.fn();
  bridge.runtime = {
    register,
    unregister,
    schedule,
    interact,
    acquireGlyphAtlas,
    resources: () => resources,
  };
  const position = { history: 0, offset: 0 };
  const cursor = { x: 0, y: 0, visible: true, blinking: false, style: "block" };
  let damage = () => {};
  let origin = 0;
  const track =
    <Args extends unknown[], Result>(
      name: string,
      fn: (...args: Args) => Result,
    ) =>
    (...args: Args): Result => {
      calls.push(name);
      return fn(...args);
    };
  const sparse = (name: string) =>
    vi.fn(() => {
      sparseApiCalls.push(name);
      throw new Error(`${name} must not be called by the WebGPU surface`);
    });
  const dims = { cols: 120, rows: 40 };
  const model = {
    get cols() {
      return dims.cols;
    },
    get rows() {
      return dims.rows;
    },
    cursor: track("cursor", () => cursor),
    presentationSuppressed: () => false,
    deferPresentation: () => false,
    consumeGpuFrame: vi.fn(
      track("consumeGpuFrame", (frameOptions?: { resync?: boolean }) =>
        gpu.consume(dims.cols, dims.rows, frameOptions?.resync === true),
      ),
    ),
    renderCells: sparse("renderCells"),
    consumeDamage: sparse("consumeDamage"),
    viewport: sparse("viewport"),
    viewportOriginLine: track("viewportOriginLine", () => origin),
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
    scrollPosition: track("scrollPosition", () => position),
    scrollTo: vi.fn((offset: number) => {
      position.offset = offset;
      damage();
    }),
    modes: () => ({ alternateScreen: false, mouseTracking: false }),
    setPixelSize: vi.fn(),
    releasePresentationResources: vi.fn(),
    compactPresentationResources: vi.fn(),
    blockSearchActive: () => mask.bytes !== null,
    searchViewportMatches: () => [],
    resize: (cols: number, rows: number) => {
      dims.cols = cols;
      dims.rows = rows;
      gpu.resize(cols, rows);
    },
  };
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setViewport: vi.fn(),
    setScissorRect: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const onError = vi.fn();
  const onResize = vi.fn();
  const onOpenLink = vi.fn();
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
    onResize,
    onError,
    onOpenLink,
    // Grid changes are rate limited in production; tests that are not about that apply at once.
  });
  surfaces.push(surface);
  const mask: { bytes: number[] | null } = { bytes: null };
  const searchController = surface.searchController();
  vi.spyOn(searchController, "maskRevision", "get").mockImplementation(
    () => maskRevision,
  );
  vi.spyOn(searchController, "viewportMaskBytes").mockImplementation(() =>
    mask.bytes ? Uint8Array.from(mask.bytes) : null,
  );
  let maskRevision = 0;
  const hostElement = element();
  surface.attach(hostElement as unknown as HTMLElement);
  const lastBuffer = (label: string) =>
    [...buffers].reverse().find((buffer) => buffer.label?.includes(label));
  return {
    surface,
    onOpenLink,
    cursor,
    writeBuffer,
    createBuffer,
    createBindGroup,
    draw: pass.draw,
    pass,
    render: (budget?: { exhausted(allowance?: number): boolean }) =>
      surface.prepareFrame(resources as never, budget),
    encode: () =>
      surface.encode(
        pass as unknown as GPURenderPassEncoder,
        resources as never,
      ),
    paneRect,
    setBounds,
    register,
    unregister,
    host: hostElement,
    model,
    gpu,
    atlas,
    lease,
    position,
    domWork,
    scrollReads,
    rectReads,
    schedule,
    interact,
    elements,
    damage: () => damage(),
    destroy,
    acquireGlyphAtlas,
    onError,
    onResize,
    calls,
    sparseApiCalls,
    get origin() {
      return origin;
    },
    set origin(value: number) {
      origin = value;
    },
    lastCellsBuffer: () => lastBuffer("cell records"),
    lastUniformBuffer: () => lastBuffer("surface uniform"),
    lastGlyphMapBuffer: () => lastBuffer("glyph map"),
    lastSearchBuffer: () =>
      lastBuffer("search mask") as
        | { destroy: ReturnType<typeof vi.fn> }
        | undefined,
    setMask(bytes: number[] | null) {
      mask.bytes = bytes;
      maskRevision += 1;
    },
    observe(entry: {
      width: number;
      height: number;
      left: number;
      top: number;
      device?: { width: number; height: number };
    }) {
      // A real host reports its new size to whoever measures it later, too.
      hostElement.getBoundingClientRect = () => ({
        width: entry.width,
        height: entry.height,
        left: entry.left,
        top: entry.top,
      });
      const root = elements.find(
        (e) => e.getAttribute("data-terax-ghostty-surface") === "webgpu",
      );
      if (root) {
        root.getBoundingClientRect = () => ({
          width: entry.width,
          height: entry.height,
          left: entry.left,
          top: entry.top,
        });
      }
      observed?.([
        {
          contentRect: { width: entry.width, height: entry.height },
          devicePixelContentBoxSize: entry.device
            ? [
                {
                  inlineSize: entry.device.width,
                  blockSize: entry.device.height,
                },
              ]
            : undefined,
        },
      ]);
    },
    setScale(value: number) {
      scale = value;
    },
    dprChange() {
      dprListener?.();
    },
    visibility(visible: boolean) {
      bridge.visible = visible;
      surface.handleVisibilityChange(visible);
    },
    resources,
  };
}

function createFrameState(initialCols: number, initialRows: number) {
  let cols = initialCols;
  let rows = initialRows;
  let first = true;
  const state: FakeFrameState & {
    consume(c: number, r: number, resync: boolean): GhosttyGpuFrame;
    resize(c: number, r: number): void;
  } = {
    epoch: 1,
    table: [],
    announced: [],
    dirtyRanges: [],
    damage: { kind: "none" },
    blinking: 0,
    cells: new Uint8Array(cols * rows * CELL),
    dirty(ranges) {
      state.dirtyRanges = ranges;
      state.damage = { kind: "rows", ranges };
    },
    announce(glyphs) {
      for (const glyph of glyphs) {
        state.table = state.table.filter((entry) => entry.id !== glyph.id);
        state.table.push(glyph);
      }
      state.announced.push(...glyphs);
      state.damage = { kind: "rows", ranges: [{ start: 0, end: 0 }] };
    },
    setCell(index, glyph) {
      new Uint32Array(state.cells.buffer)[index * 4] = glyph;
    },
    resize(c, r) {
      cols = c;
      rows = r;
      state.cells = new Uint8Array(c * r * CELL);
      first = true;
    },
    consume(c, r, resync) {
      cols = c;
      rows = r;
      const full = first || resync;
      first = false;
      const frame: GhosttyGpuFrame = {
        rows,
        cols,
        epoch: state.epoch,
        fullDamage: full,
        dirtyRanges: full ? [{ start: 0, end: rows - 1 }] : state.dirtyRanges,
        damage: full ? { kind: "full" } : state.damage,
        cells: state.cells,
        memory: {} as WebAssembly.Memory,
        blinkingCells: state.blinking,
        glyphCount: state.table.reduce(
          (max, glyph) => Math.max(max, glyph.id),
          0,
        ),
        newGlyphs: resync ? [...state.table] : [...state.announced],
      };
      state.dirtyRanges = [];
      state.damage = { kind: "none" };
      state.announced = [];
      return frame;
    },
  };
  return state;
}
