type CanvasTarget = {
  width: number;
  height: number;
  readonly style: {
    width: string;
    height: string;
  };
};

/** Device pixels the store may grow to while a resize gesture runs; read only when it must grow. */
export type GestureGrowth = () => {
  readonly width: number;
  readonly height: number;
};

/**
 * Stages and commits a canvas backing store whose CSS size is always exactly
 * `backing / scale`, so one canvas pixel is one device pixel. Nearby required
 * sizes reuse a slightly larger store instead of reallocating the swapchain on
 * every drag step; renderers draw into the exact sub-rectangle (a viewport)
 * and the surplus is cleared to the background and clipped by the host.
 *
 * During a resize gesture (`gesture` given to `stage`) the store never shrinks and any slack
 * is acceptable: a smaller requirement keeps the current backing, and a larger one allocates
 * once, to the bound the gesture cannot exceed. The first `stage` after the gesture, without
 * `gesture`, compacts to the usual nearby size. Every reallocation of a WebGPU canvas leaves a
 * retired swapchain that WebKit keeps until the drag ends, so a drag must cost one allocation,
 * not one per step.
 */
export class CanvasBackingStore {
  private presented = false;
  private targetWidth: number;
  private targetHeight: number;
  private targetCssWidth: string;
  private targetCssHeight: string;

  constructor(private readonly canvas: CanvasTarget) {
    this.targetWidth = canvas.width;
    this.targetHeight = canvas.height;
    this.targetCssWidth = canvas.style.width;
    this.targetCssHeight = canvas.style.height;
  }

  get pending(): boolean {
    return (
      this.canvas.width !== this.targetWidth ||
      this.canvas.height !== this.targetHeight ||
      this.canvas.style.width !== this.targetCssWidth ||
      this.canvas.style.height !== this.targetCssHeight
    );
  }

  stage(
    pixelWidth: number,
    pixelHeight: number,
    scale: number,
    gesture?: GestureGrowth,
  ): boolean {
    const requiredWidth = positivePixelSize(pixelWidth);
    const requiredHeight = positivePixelSize(pixelHeight);
    const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
    let nextTargetWidth = requiredWidth;
    let nextTargetHeight = requiredHeight;
    if (this.presented && gesture) {
      const grows =
        requiredWidth > this.targetWidth || requiredHeight > this.targetHeight;
      const bound = grows ? gesture() : null;
      nextTargetWidth = gestureDimension(
        this.targetWidth,
        requiredWidth,
        bound?.width,
      );
      nextTargetHeight = gestureDimension(
        this.targetHeight,
        requiredHeight,
        bound?.height,
      );
    } else if (this.presented) {
      nextTargetWidth = reusableDimension(this.targetWidth, requiredWidth);
      nextTargetHeight = reusableDimension(this.targetHeight, requiredHeight);
    }
    const targetCssWidth = `${nextTargetWidth / ratio}px`;
    const targetCssHeight = `${nextTargetHeight / ratio}px`;
    const changed =
      this.targetWidth !== nextTargetWidth ||
      this.targetHeight !== nextTargetHeight ||
      this.targetCssWidth !== targetCssWidth ||
      this.targetCssHeight !== targetCssHeight;
    this.targetWidth = nextTargetWidth;
    this.targetHeight = nextTargetHeight;
    this.targetCssWidth = targetCssWidth;
    this.targetCssHeight = targetCssHeight;
    return changed;
  }

  commit(): boolean {
    if (!this.pending) return false;
    this.presented = true;
    if (this.canvas.style.width !== this.targetCssWidth) {
      this.canvas.style.width = this.targetCssWidth;
    }
    if (this.canvas.style.height !== this.targetCssHeight) {
      this.canvas.style.height = this.targetCssHeight;
    }
    if (this.canvas.width !== this.targetWidth) {
      this.canvas.width = this.targetWidth;
    }
    if (this.canvas.height !== this.targetHeight) {
      this.canvas.height = this.targetHeight;
    }
    return true;
  }

  /** The backing size (device pixels) the canvas holds right now. */
  get size(): { readonly width: number; readonly height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }
}

// Nearby sizes reuse storage instead of accumulating retired presentation buffers.
function reusableDimension(current: number, required: number): number {
  const alignment = required < 256 ? 32 : 128;
  if (required <= current && current - required < alignment * 2) return current;
  return Math.ceil(required / alignment) * alignment;
}

// Inside a gesture the backing only ever grows. When it must, every axis goes to the bound at
// once: the axes outgrow their backing at different moments, and one allocation per gesture is
// the point.
function gestureDimension(
  current: number,
  required: number,
  bound: number | undefined,
): number {
  if (bound === undefined) return current;
  return Math.max(current, required, positivePixelSize(bound));
}

function positivePixelSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}
