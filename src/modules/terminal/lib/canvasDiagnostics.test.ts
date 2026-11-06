import { afterEach, expect, it, vi } from "vitest";
import { terminalCanvasDiagnostics } from "./canvasDiagnostics";

afterEach(() => vi.unstubAllGlobals());

it.each([1, 1.25, 1.5, 2])(
  "reports native canvas alignment on demand at DPR %s",
  (scale) => {
    const canvas = {
      width: 1252,
      height: 802,
      getBoundingClientRect: vi.fn(() => ({
        x: 11,
        y: 21,
        width: 1252 / scale,
        height: 802 / scale,
      })),
    };
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("window", { devicePixelRatio: scale });
    vi.stubGlobal("document", { querySelectorAll: () => [canvas] });
    vi.stubGlobal("getComputedStyle", () => ({ transform: "none" }));

    const [pending] = terminalCanvasDiagnostics();
    expect(pending).toMatchObject({
      devicePixelRatio: scale,
      backingMatchesCss: true,
      devicePixelContentBoxStatus: "pending",
      devicePixelContentBoxSize: null,
    });
    expect(observe).toHaveBeenCalledOnce();
    callbacks[0](
      [
        { devicePixelContentBoxSize: [{ inlineSize: 1252, blockSize: 802 }] },
      ] as never,
      {} as ResizeObserver,
    );
    expect(disconnect).toHaveBeenCalledOnce();
    expect(terminalCanvasDiagnostics()[0]).toMatchObject({
      backingSize: { width: 1252, height: 802 },
      devicePixelContentBoxSize: { width: 1252, height: 802 },
      backingMatchesDevicePixelBox: true,
      transform: "none",
    });
    expect(observe).toHaveBeenCalledOnce();

    // A backing/CSS mismatch is visible immediately, without another observer delivery.
    canvas.width++;
    expect(terminalCanvasDiagnostics()[0]).toMatchObject({
      backingMatchesCss: false,
      backingMatchesDevicePixelBox: false,
    });

    // A display change invalidates the cached device box. WebKit's absent box is explicit.
    window.devicePixelRatio = scale + 0.25;
    expect(terminalCanvasDiagnostics()[0].devicePixelContentBoxStatus).toBe(
      "pending",
    );
    callbacks[1]([{}] as never, {} as ResizeObserver);
    expect(terminalCanvasDiagnostics()[0]).toMatchObject({
      devicePixelContentBoxStatus: "unsupported",
      devicePixelContentBoxSize: null,
      backingMatchesDevicePixelBox: null,
    });
  },
);
