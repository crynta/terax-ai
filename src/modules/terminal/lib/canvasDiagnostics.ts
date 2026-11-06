type Size = { width: number; height: number };
type Sample = { key: string; size: Size | null; pending: boolean };
const samples = new WeakMap<HTMLCanvasElement, Sample>();

/** On-demand only. Call again after an observer delivery for the native device-pixel box. */
export function terminalCanvasDiagnostics() {
  const devicePixelRatio = window.devicePixelRatio;
  return Array.from(
    document.querySelectorAll<HTMLCanvasElement>(
      "[data-terax-terminal-canvas]",
    ),
    (canvas) => {
      const rect = canvas.getBoundingClientRect();
      const cssSize = { width: rect.width, height: rect.height };
      const backingSize = { width: canvas.width, height: canvas.height };
      const cssDeviceSize = {
        width: Math.round(rect.width * devicePixelRatio),
        height: Math.round(rect.height * devicePixelRatio),
      };
      const key = [
        devicePixelRatio,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      ].join();
      let sample = samples.get(canvas);
      if (sample?.key !== key) {
        sample = { key, size: null, pending: true };
        samples.set(canvas, sample);
        const current = sample;
        const observer = new ResizeObserver(([entry]) => {
          observer.disconnect();
          const box = entry.devicePixelContentBoxSize?.[0];
          current.size = box
            ? { width: box.inlineSize, height: box.blockSize }
            : null;
          current.pending = false;
        });
        // A one-shot content-box observation also reports the device box on Chromium;
        // WebKit omits it. No observer or DOM reads are added to rendering frames.
        observer.observe(canvas);
      }
      const devicePixelContentBoxSize = sample.size;
      return {
        devicePixelRatio,
        cssSize,
        backingSize,
        cssDeviceSize,
        devicePixelContentBoxSize,
        devicePixelContentBoxStatus: sample.pending
          ? "pending"
          : sample.size
            ? "available"
            : "unsupported",
        backingMatchesCss: sameSize(backingSize, cssDeviceSize),
        backingMatchesDevicePixelBox: devicePixelContentBoxSize
          ? sameSize(backingSize, devicePixelContentBoxSize)
          : null,
        transform: getComputedStyle(canvas).transform,
      };
    },
  );
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}
