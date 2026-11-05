import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import type { WindowPresentation } from "@/modules/terminal/ghostty/WindowPresentationPolicy";
import type { WebGlCellRenderer } from "@/modules/terminal/ghostty/webgl/WebGlCellRenderer";
import { TERMINAL_RIGHT_GUTTER_CSS_PX } from "@/modules/terminal/ghostty/gpu/TerminalFit";
import { WebGlPoolExhaustedError } from "@/modules/terminal/ghostty/webgl/WebGlPoolExhaustedError";
import { WebGlTerminalSurface } from "@/modules/terminal/ghostty/webgl/WebGlTerminalSurface";

const bridge = vi.hoisted(() => ({
  runtime: {} as unknown,
  visibility: (_state: WindowPresentation) => {},
}));
vi.mock("@/modules/terminal/ghostty/webgl/WebGlTerminalRuntime", () => ({
  getWebGlTerminalRuntime: () => bridge.runtime,
}));
vi.mock("@/modules/terminal/ghostty/windowPresentation", () => ({
  terminalWindowPresentation: () => ({ visible: true, reclaim: false }),
  subscribeWindowPresentation: (listener: typeof bridge.visibility) => {
    bridge.visibility = listener;
    return () => {};
  },
}));

const surfaces: WebGlTerminalSurface[] = [];
afterEach(() => {
  for (const surface of surfaces.splice(0)) surface.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WebGL surface renderer ownership", () => {
  it.each(["theme", "font", "resume", "dpr"] as const)(
    "clears disposed renderer ownership when %s reconfiguration and recovery both fail",
    (trigger) => {
      const h = harness();
      h.acquire.mockImplementation(() => {
        throw new Error("configure failed");
      });
      const calls = h.renderer.resize.mock.calls.length;
      h.trigger(trigger);
      expect(h.onError).toHaveBeenCalledOnce();
      expect(h.surface.diagnostics().renderer).toBeNull();
      expect(h.renderer.resize).toHaveBeenCalledTimes(calls);
      h.surface.setFontMetrics({
        ...METRICS,
        deviceCellWidth: 10,
        cellWidth: 10,
      });
      h.resize();
      expect(
        h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer),
      ).toBe(false);
      expect(h.renderer.resize).toHaveBeenCalledTimes(calls);
      expect(h.renderer.resetModel).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("replaces a failed renderer once while retaining model and selection", () => {
    const h = harness();
    const replacement = renderer();
    h.acquire.mockImplementationOnce(() => {
      throw new Error("configure failed");
    });
    h.acquire.mockReturnValue(replacement);
    h.trigger("font");
    expect(h.surface.diagnostics().rendererRecoveries).toBe(1);
    expect(h.surface.getSelection()).toBe("selected output");
    expect(h.renderer.resetModel).not.toHaveBeenCalled();
    expect(replacement.resize).toHaveBeenCalledOnce();
    expect(replacement.resetModel).toHaveBeenCalledOnce();
    expect(
      h.surface.renderFrame(replacement as unknown as WebGlCellRenderer),
    ).toBe(true);
    expect(h.onError).not.toHaveBeenCalled();
  });
});

describe("WebGL surface pool exhaustion", () => {
  it("shows the error and retry state instead of throwing when no context is free", () => {
    const h = harness();
    h.acquire.mockImplementation(() => {
      throw new WebGlPoolExhaustedError(12);
    });
    h.surface.detach();
    h.acquire.mockClear();
    h.onError.mockClear();
    expect(() => h.surface.attach(h.host)).not.toThrow();
    expect(h.onError).toHaveBeenCalledOnce();
    expect(h.onError.mock.calls[0][0]).toBeInstanceOf(WebGlPoolExhaustedError);
    // A retry could not succeed either, so none is attempted.
    expect(h.acquire).toHaveBeenCalledOnce();
    expect(h.surface.diagnostics().renderer).toBeNull();
  });

  it("does not throw when a pane that became visible finds the pool full", () => {
    const h = harness();
    h.surface.setVisible(false);
    h.acquire.mockImplementation(() => {
      throw new WebGlPoolExhaustedError(12);
    });
    h.onError.mockClear();
    expect(() => h.surface.setVisible(true)).not.toThrow();
    expect(h.onError).toHaveBeenCalledOnce();
  });
});

describe("WebGL surface resizing", () => {
  it("keeps the model, the PTY and the renderer still during a gesture and applies the final size once", () => {
    const h = harness();
    h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer);
    vi.advanceTimersByTime(500);
    const rendererResizes = h.renderer.resize.mock.calls.length;
    const first = h.surface.diagnostics().cols;
    h.onResize.mockClear();

    const token = {};
    beginTerminalResizeInteraction(token);
    for (let step = 1; step <= 62; step++) {
      h.setHost(960 - step * 8);
      h.resize();
      h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer);
      vi.advanceTimersByTime(16);
      h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer);
    }
    expect(h.onResize).not.toHaveBeenCalled();
    expect(h.renderer.resize).toHaveBeenCalledTimes(rendererResizes);
    expect(h.surface.diagnostics().cols).toBe(first);

    endTerminalResizeInteraction(token);
    h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer);

    const cols = Math.floor((960 - 62 * 8) / 8);
    expect(h.onResize).toHaveBeenCalledOnce();
    expect(h.onResize).toHaveBeenCalledWith(cols, expect.any(Number));
    expect(h.surface.diagnostics().cols).toBe(cols);
  });

  it("applies a change outside a gesture at once", () => {
    const h = harness();
    h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer);
    vi.advanceTimersByTime(500);
    h.onResize.mockClear();

    h.setHost(800);
    h.resize();
    h.surface.renderFrame(h.renderer as unknown as WebGlCellRenderer);

    expect(h.onResize).toHaveBeenCalledOnce();
    expect(h.surface.diagnostics().cols).toBe(100);
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
  scale: 1,
  deviceCellWidth: 8,
  deviceCellHeight: 16,
  deviceBaseline: 12,
  cellWidth: 8,
  cellHeight: 16,
  baseline: 12,
};
const THEME = {
  background: [0, 0, 0],
  foreground: [255, 255, 255],
  cursor: [255, 255, 255],
  cursorText: [0, 0, 0],
  selection: { color: [50, 50, 50], alpha: 0.5 },
  palette: [],
} as const;

function renderer() {
  return {
    resize: vi.fn(() => false),
    resetModel: vi.fn(),
    render: vi.fn(() => true),
    diagnostics: vi.fn(() => ({})),
    requestPresentation: vi.fn(),
    hasBlinkingCells: false,
  };
}

function measuringContext() {
  const context = {
    font: "",
    measureText: () => {
      const size = Number.parseFloat(
        /([\d.]+)px/.exec(context.font)?.[1] ?? "14",
      );
      return {
        width: size * 0.6,
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
      };
    },
  };
  return context;
}

function harness() {
  vi.useFakeTimers();
  const element = () =>
    Object.assign(new EventTarget(), {
      style: { setProperty: vi.fn() },
      scrollTop: 0,
      setAttribute: vi.fn(),
      getAttribute: vi.fn(),
      append: vi.fn(),
      appendChild: vi.fn(),
      remove: vi.fn(),
      getBoundingClientRect: () => ({ width: 960, height: 640 }),
      getContext: () => measuringContext(),
    });
  const media = new EventTarget();
  vi.stubGlobal("document", { createElement: element });
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    setTimeout,
    clearTimeout,
    matchMedia: () => media,
  });
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        resize = () => callback([]);
      }
      observe() {}
      disconnect() {}
    },
  );
  const current = renderer();
  const acquire = vi.fn(() => current);
  bridge.runtime = {
    acquire,
    release: vi.fn(),
    discard: vi.fn(),
    schedule: vi.fn(),
    interact: vi.fn(),
    trimForHiddenDocument: vi.fn(),
  };
  const model = {
    cols: 120,
    rows: 40,
    setCursorOptions: vi.fn(),
    revision: () => 0,
    subscribeDamage: () => () => {},
    trackedSelection: () => ({
      anchor: { line: 0, column: 0 },
      focus: { line: 0, column: 10 },
      rectangular: false,
    }),
    selectionText: () => "selected output",
    scrollPosition: () => ({ history: 0, offset: 0 }),
    viewportOriginLine: () => 0,
    modes: () => ({ alternateScreen: false }),
    setPixelSize: vi.fn(),
    compactPresentationResources: vi.fn(),
    releasePresentationResources: vi.fn(),
    resize: (cols: number, rows: number) => {
      model.cols = cols;
      model.rows = rows;
    },
    cursor: () => ({ x: 0, y: 0, visible: true, blinking: false }),
    deferPresentation: () => false,
    consumeDamage: () => ({ kind: "none" }),
  };
  const onError = vi.fn();
  const onResize = vi.fn();
  const surface = new WebGlTerminalSurface({
    model: model as unknown as GhosttyTerminalModelApi,
    metrics: METRICS,
    theme: THEME,
    cursorBlink: false,
    cursorStyle: "block",
    onResize,
    onError,
  });
  surfaces.push(surface);
  const hostElement = element();
  const hostSize = { width: 960 + TERMINAL_RIGHT_GUTTER_CSS_PX, height: 640 };
  hostElement.getBoundingClientRect = () => ({ ...hostSize });
  surface.attach(hostElement as unknown as HTMLElement);
  return {
    surface,
    host: hostElement as unknown as HTMLElement,
    onResize,
    setHost(width: number, height = 640) {
      hostSize.width = width + TERMINAL_RIGHT_GUTTER_CSS_PX;
      hostSize.height = height;
    },
    renderer: current,
    acquire,
    onError,
    resize: () => resize(),
    trigger(trigger: "theme" | "font" | "resume" | "dpr") {
      if (trigger === "theme")
        surface.setTheme({ ...THEME, background: [1, 2, 3] });
      if (trigger === "font")
        surface.setFontMetrics({
          ...METRICS,
          deviceCellWidth: 9,
          cellWidth: 9,
        });
      if (trigger === "resume") {
        bridge.visibility({ visible: false, reclaim: false });
        bridge.visibility({ visible: true, reclaim: false });
      }
      if (trigger === "dpr") {
        window.devicePixelRatio = 2;
        media.dispatchEvent(new Event("change"));
      }
    },
  };
}
