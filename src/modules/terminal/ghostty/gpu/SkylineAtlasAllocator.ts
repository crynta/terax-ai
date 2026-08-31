export type AtlasRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type SkylineNode = {
  x: number;
  y: number;
  width: number;
};

export class SkylineAtlasAllocator {
  private readonly skyline: SkylineNode[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.reset();
  }

  allocate(width: number, height: number): AtlasRegion | null {
    if (
      width <= 0 ||
      height <= 0 ||
      width > this.width ||
      height > this.height
    ) {
      return null;
    }

    let bestIndex = -1;
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;
    let bestWidth = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.skyline.length; index += 1) {
      const y = this.findY(index, width, height);
      if (y < 0) continue;
      const node = this.skyline[index];
      if (
        y + height < bestY ||
        (y + height === bestY && node.width < bestWidth)
      ) {
        bestIndex = index;
        bestX = node.x;
        bestY = y + height;
        bestWidth = node.width;
      }
    }

    if (bestIndex < 0) return null;
    const regionY = bestY - height;
    this.skyline.splice(bestIndex, 0, {
      x: bestX,
      y: bestY,
      width,
    });

    for (let index = bestIndex + 1; index < this.skyline.length; index += 1) {
      const previous = this.skyline[index - 1];
      const node = this.skyline[index];
      const overlap = previous.x + previous.width - node.x;
      if (overlap <= 0) break;
      node.x += overlap;
      node.width -= overlap;
      if (node.width > 0) break;
      this.skyline.splice(index, 1);
      index -= 1;
    }

    this.mergeNeighbors();
    return { x: bestX, y: regionY, width, height };
  }

  reset(): void {
    this.skyline.length = 0;
    this.skyline.push({ x: 0, y: 0, width: this.width });
  }

  private findY(index: number, width: number, height: number): number {
    const x = this.skyline[index].x;
    if (x + width > this.width) return -1;

    let widthLeft = width;
    let y = this.skyline[index].y;
    for (let current = index; widthLeft > 0; current += 1) {
      const node = this.skyline[current];
      if (!node) return -1;
      y = Math.max(y, node.y);
      if (y + height > this.height) return -1;
      widthLeft -= node.width;
    }
    return y;
  }

  private mergeNeighbors(): void {
    for (let index = 0; index < this.skyline.length - 1; index += 1) {
      const current = this.skyline[index];
      const next = this.skyline[index + 1];
      if (current.y !== next.y) continue;
      current.width += next.width;
      this.skyline.splice(index + 1, 1);
      index -= 1;
    }
  }
}
