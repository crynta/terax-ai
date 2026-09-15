export const CELL_STRIDE = 16;

const CELL_OFFSET = {
  codepoint: 0,
  foreground: 4,
  background: 7,
  flags: 10,
  width: 11,
  graphemeLength: 14,
} as const;

export type Rgb = readonly [red: number, green: number, blue: number];

export interface TerminalCellReader {
  readonly length: number;
  codepoint(index: number): number;
  flags(index: number): number;
  width(index: number): number;
  graphemeLength(index: number): number;
  underlineStyle(index: number): number;
  underlineColorPacked(index: number): number;
  overline(index: number): boolean;
  foreground(index: number): Rgb;
  foregroundPacked(index: number): number;
  background(index: number): Rgb;
  backgroundPacked(index: number): number;
}

export class PackedCellView implements TerminalCellReader {
  private readonly data: DataView;

  constructor(readonly bytes: Uint8Array) {
    if (bytes.byteLength % CELL_STRIDE !== 0) {
      throw new Error("Packed terminal cells must use a 16-byte stride");
    }
    this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength / CELL_STRIDE;
  }

  codepoint(index: number): number {
    return this.data.getUint32(
      index * CELL_STRIDE + CELL_OFFSET.codepoint,
      true,
    );
  }

  flags(index: number): number {
    return this.bytes[index * CELL_STRIDE + CELL_OFFSET.flags];
  }

  width(index: number): number {
    return this.bytes[index * CELL_STRIDE + CELL_OFFSET.width];
  }

  graphemeLength(index: number): number {
    return this.bytes[index * CELL_STRIDE + CELL_OFFSET.graphemeLength];
  }

  underlineStyle(index: number): number {
    return (this.flags(index) & (1 << 2)) !== 0 ? 1 : 0;
  }

  underlineColorPacked(index: number): number {
    return this.foregroundPacked(index);
  }

  overline(_index: number): boolean {
    return false;
  }

  foreground(index: number): Rgb {
    const offset = index * CELL_STRIDE + CELL_OFFSET.foreground;
    return [this.bytes[offset], this.bytes[offset + 1], this.bytes[offset + 2]];
  }

  foregroundPacked(index: number): number {
    const offset = index * CELL_STRIDE + CELL_OFFSET.foreground;
    return (
      (this.bytes[offset] << 16) |
      (this.bytes[offset + 1] << 8) |
      this.bytes[offset + 2]
    );
  }

  background(index: number): Rgb {
    const offset = index * CELL_STRIDE + CELL_OFFSET.background;
    return [this.bytes[offset], this.bytes[offset + 1], this.bytes[offset + 2]];
  }

  backgroundPacked(index: number): number {
    const offset = index * CELL_STRIDE + CELL_OFFSET.background;
    return (
      (this.bytes[offset] << 16) |
      (this.bytes[offset + 1] << 8) |
      this.bytes[offset + 2]
    );
  }
}

export function writeNormalizedColor(
  target: Float32Array,
  offset: number,
  color: Rgb,
  alpha: number,
): void {
  target[offset] = color[0] / 255;
  target[offset + 1] = color[1] / 255;
  target[offset + 2] = color[2] / 255;
  target[offset + 3] = alpha;
}
