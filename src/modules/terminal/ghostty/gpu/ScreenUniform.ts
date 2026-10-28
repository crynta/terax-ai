import {
  SCREEN_FLAG_SEARCH_ACTIVE,
  SCREEN_FLAG_SELECTION_ACTIVE,
  SCREEN_FLAG_SELECTION_RECTANGULAR,
  SCREEN_FLAG_TEXT_BLINK_VISIBLE,
  SCREEN_OFFSET,
  SCREEN_UNIFORM_BYTES,
} from "./shaders";
import type {
  CursorRect,
  DecorationMetrics,
  SelectionUniform,
} from "./terminalGeometry";
import { DWRITE_GAMMA_RATIOS, type TextContrast } from "./textContrast";

export type ScreenUniformState = {
  readonly cols: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** The pane's rectangle in the shared window canvas, whole device pixels. */
  readonly viewport: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Device pixels of the pane cut off left of / above the canvas (see `DeviceRect`). */
    readonly clipX?: number;
    readonly clipY?: number;
  };
  /**
   * Device pixels the grid is moved up inside the viewport, so a pane shorter than its grid
   * (a resize gesture in progress) keeps the cursor row on screen. Zero at rest.
   */
  readonly shiftY: number;
  readonly textBlinkVisible: boolean;
  readonly searchActive: boolean;
  readonly cursor: CursorRect | null;
  readonly cursorColor: readonly [number, number, number];
  readonly background: readonly [number, number, number];
  readonly selection: SelectionUniform;
  readonly selectionColor: readonly [number, number, number];
  readonly selectionAlpha: number;
  readonly decoration: DecorationMetrics;
  readonly leftOverhangPadding: number;
  readonly contrast: TextContrast;
};

/** Packs the shader's `Screen` uniform and detects changes without allocating. */
export class ScreenUniform {
  private readonly buffer = new ArrayBuffer(SCREEN_UNIFORM_BYTES);
  private readonly floats = new Float32Array(this.buffer);
  private readonly uints = new Uint32Array(this.buffer);
  private readonly ints = new Int32Array(this.buffer);
  private readonly uploaded = new Uint32Array(SCREEN_UNIFORM_BYTES / 4);
  private hasUploaded = false;

  get data(): Float32Array {
    return this.floats;
  }

  pack(state: ScreenUniformState): void {
    const floats = this.floats;
    const uints = this.uints;
    const ints = this.ints;
    uints.fill(0);
    floats[SCREEN_OFFSET.viewportSize / 4] = state.viewport.width;
    floats[SCREEN_OFFSET.viewportSize / 4 + 1] = state.viewport.height;
    const clipX = Math.max(0, state.viewport.clipX ?? 0);
    const clipY = Math.max(0, state.viewport.clipY ?? 0);
    ints[SCREEN_OFFSET.origin / 4] = state.viewport.x - clipX;
    ints[SCREEN_OFFSET.origin / 4 + 1] = state.viewport.y - clipY;
    uints[SCREEN_OFFSET.clip / 4] = clipX;
    uints[SCREEN_OFFSET.clip / 4 + 1] = clipY;
    uints[SCREEN_OFFSET.cellSize / 4] = state.cellWidth;
    uints[SCREEN_OFFSET.cellSize / 4 + 1] = state.cellHeight;
    uints[SCREEN_OFFSET.dims / 4] = state.cols;
    uints[SCREEN_OFFSET.dims / 4 + 1] = state.rows;
    let flags = 0;
    if (state.textBlinkVisible) flags |= SCREEN_FLAG_TEXT_BLINK_VISIBLE;
    if (state.searchActive) flags |= SCREEN_FLAG_SEARCH_ACTIVE;
    if (state.selection.active) flags |= SCREEN_FLAG_SELECTION_ACTIVE;
    if (state.selection.rectangular) flags |= SCREEN_FLAG_SELECTION_RECTANGULAR;
    uints[SCREEN_OFFSET.flags / 4] = flags;
    uints[SCREEN_OFFSET.shiftY / 4] = Math.max(0, Math.round(state.shiftY));
    if (state.cursor) {
      floats[SCREEN_OFFSET.cursorOrigin / 4] = state.cursor.x;
      floats[SCREEN_OFFSET.cursorOrigin / 4 + 1] = state.cursor.y;
      floats[SCREEN_OFFSET.cursorSize / 4] = state.cursor.width;
      floats[SCREEN_OFFSET.cursorSize / 4 + 1] = state.cursor.height;
    }
    writeColor(floats, SCREEN_OFFSET.cursorColor / 4, state.cursorColor, 1);
    writeColor(floats, SCREEN_OFFSET.themeBackground / 4, state.background, 1);
    writeColor(
      floats,
      SCREEN_OFFSET.selectionColor / 4,
      state.selectionColor,
      state.selectionAlpha,
    );
    const selection = state.selection;
    ints[SCREEN_OFFSET.selectionLines / 4] = selection.startLine;
    ints[SCREEN_OFFSET.selectionLines / 4 + 1] = selection.startColumn;
    ints[SCREEN_OFFSET.selectionLines / 4 + 2] = selection.endLine;
    ints[SCREEN_OFFSET.selectionLines / 4 + 3] = selection.endColumn;
    ints[SCREEN_OFFSET.selectionColumns / 4] = selection.left;
    ints[SCREEN_OFFSET.selectionColumns / 4 + 1] = selection.right;
    uints[SCREEN_OFFSET.decoration / 4] = state.decoration.baseline;
    uints[SCREEN_OFFSET.decoration / 4 + 1] = state.decoration.thickness;
    uints[SCREEN_OFFSET.decoration / 4 + 2] = state.decoration.strikeY;
    uints[SCREEN_OFFSET.decoration / 4 + 3] = state.leftOverhangPadding;
    floats[SCREEN_OFFSET.contrast / 4] = state.contrast.enhancedContrast;
    floats[SCREEN_OFFSET.contrast / 4 + 1] = state.contrast.alphaCorrection;
    for (let index = 0; index < DWRITE_GAMMA_RATIOS.length; index += 1) {
      floats[SCREEN_OFFSET.gamma / 4 + index] = DWRITE_GAMMA_RATIOS[index];
    }
  }

  /** True if the packed state differs from what `markUploaded` last recorded. */
  changed(): boolean {
    if (!this.hasUploaded) return true;
    for (let index = 0; index < this.uints.length; index += 1) {
      if (this.uints[index] !== this.uploaded[index]) return true;
    }
    return false;
  }

  markUploaded(): void {
    this.uploaded.set(this.uints);
    this.hasUploaded = true;
  }

  invalidate(): void {
    this.hasUploaded = false;
  }
}

function writeColor(
  target: Float32Array,
  offset: number,
  color: readonly [number, number, number],
  alpha: number,
): void {
  target[offset] = color[0] / 255;
  target[offset + 1] = color[1] / 255;
  target[offset + 2] = color[2] / 255;
  target[offset + 3] = alpha;
}
