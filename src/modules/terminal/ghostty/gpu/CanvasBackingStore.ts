type CanvasTarget = {
  width: number;
  height: number;
  readonly style: {
    width: string;
    height: string;
  };
};

export class CanvasBackingStore {
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
    cssWidth: number,
    cssHeight: number,
  ): boolean {
    const nextTargetWidth = positivePixelSize(pixelWidth);
    const nextTargetHeight = positivePixelSize(pixelHeight);
    const targetCssWidth = `${positiveCssSize(cssWidth)}px`;
    const targetCssHeight = `${positiveCssSize(cssHeight)}px`;
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
}

function positivePixelSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

function positiveCssSize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}
