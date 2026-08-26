import { OfficialGhosttyAbi } from "./abi";
import { OfficialGhosttyCallbackBridge } from "./callbackBridge";
import {
  GhosttyBuildInfoKey,
  GhosttyOptimizeMode,
  GhosttyRenderStateCursorStyle,
  GhosttyRenderStateData,
  GhosttyRenderStateDirty,
  GhosttyRenderStateRowData,
  GhosttyResult,
  GhosttyTerminalData,
  GhosttyTerminalOption,
  type OfficialGhosttyBuildInfo,
  type OfficialGhosttyColor,
  type OfficialGhosttyRawRow,
  type OfficialGhosttyRenderColors,
  type OfficialGhosttyRenderCursor,
  type OfficialGhosttyTerminalOptions,
  type OfficialGhosttyWasmExports,
} from "./types";

const MAX_REPLY_BYTES_PER_WRITE = 64 * 1024;
const DEFAULT_SCROLLBACK_LINES = 10_000;
const DEFAULT_SCROLLBACK_BYTES = 64 * 1024 * 1024;
const DEFAULT_CONTINUATION_BYTES = 4 * 1024;
const DEFAULT_TERMINFO_NAME = "xterm-256color";

export class OfficialGhostty {
  readonly abi: OfficialGhosttyAbi;
  readonly buildInfo: OfficialGhosttyBuildInfo;

  private constructor(
    private readonly exports: OfficialGhosttyWasmExports,
    private readonly callbacks: OfficialGhosttyCallbackBridge,
  ) {
    this.abi = new OfficialGhosttyAbi(
      exports.memory,
      exports.ghostty_type_json(),
    );
    this.buildInfo = readBuildInfo(exports, this.abi);
    if (this.buildInfo.optimize !== GhosttyOptimizeMode.ReleaseFast) {
      throw new Error(
        `Expected ReleaseFast libghostty, received optimize=${this.buildInfo.optimize}`,
      );
    }
  }

  static async load(path?: string): Promise<OfficialGhostty> {
    const url =
      path ?? new URL("../../official/ghostty-vt.wasm", import.meta.url).href;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch official libghostty: ${response.status} ${response.statusText}`,
      );
    }
    const fallback = response.clone();
    try {
      const { instance } = await WebAssembly.instantiateStreaming(response, {});
      return OfficialGhostty.fromInstance(instance);
    } catch {
      return OfficialGhostty.loadBytes(await fallback.arrayBuffer());
    }
  }

  static async loadBytes(bytes: ArrayBuffer): Promise<OfficialGhostty> {
    if (bytes.byteLength === 0) throw new Error("Official libghostty is empty");
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {});
    return OfficialGhostty.fromInstance(instance);
  }

  private static async fromInstance(
    instance: WebAssembly.Instance,
  ): Promise<OfficialGhostty> {
    const exports = validateExports(instance.exports);
    const callbacks = await OfficialGhosttyCallbackBridge.create(
      exports.memory,
      exports.__indirect_function_table,
    );
    try {
      return new OfficialGhostty(exports, callbacks);
    } catch (error) {
      callbacks.dispose();
      throw error;
    }
  }

  createTerminal(
    cols: number,
    rows: number,
    options: OfficialGhosttyTerminalOptions = {},
  ): OfficialGhosttyTerminal {
    return new OfficialGhosttyTerminal(
      this.exports,
      this.abi,
      this.callbacks,
      cols,
      rows,
      options,
    );
  }

  getMemoryBytes(): number {
    return this.exports.memory.buffer.byteLength;
  }
}

export class OfficialGhosttyTerminal {
  private terminalSlot = 0;
  private renderStateSlot = 0;
  private rowIteratorSlot = 0;
  private scratch = 0;
  private readonly scratchBytes = 1024;
  private terminal = 0;
  private renderState = 0;
  private rowIterator = 0;
  private inputPointer = 0;
  private inputCapacity = 0;
  private readonly replyChunks: Uint8Array[] = [];
  private replyBytes = 0;
  private replyOverflow = false;
  private disposed = false;
  private _cols: number;
  private _rows: number;
  private cellWidthPx = 0;
  private cellHeightPx = 0;

  constructor(
    private readonly exports: OfficialGhosttyWasmExports,
    private readonly abi: OfficialGhosttyAbi,
    private readonly callbacks: OfficialGhosttyCallbackBridge,
    cols: number,
    rows: number,
    private readonly options: OfficialGhosttyTerminalOptions,
  ) {
    validateDimensions(cols, rows);
    this._cols = cols;
    this._rows = rows;

    try {
      this.terminalSlot = allocateOpaque(exports);
      this.renderStateSlot = allocateOpaque(exports);
      this.rowIteratorSlot = allocateOpaque(exports);
      this.scratch = allocateBytes(exports, this.scratchBytes);
      assertResult(
        exports.ghostty_terminal_new(0, this.terminalSlot, cols, rows),
        "ghostty_terminal_new",
      );
      this.terminal = readPointer(exports.memory, this.terminalSlot);
      if (!this.terminal)
        throw new Error("libghostty returned a null terminal");

      callbacks.register(this.terminal, (bytes) => this.enqueueReply(bytes));
      assertResult(
        exports.ghostty_terminal_set(
          this.terminal,
          GhosttyTerminalOption.WritePty,
          callbacks.writePtyTableIndex,
        ),
        "install write_pty callback",
      );
      this.configure(options);

      assertResult(
        exports.ghostty_render_state_new(0, this.renderStateSlot),
        "ghostty_render_state_new",
      );
      this.renderState = readPointer(exports.memory, this.renderStateSlot);
      assertResult(
        exports.ghostty_render_state_row_iterator_new(0, this.rowIteratorSlot),
        "ghostty_render_state_row_iterator_new",
      );
      this.rowIterator = readPointer(exports.memory, this.rowIteratorSlot);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  write(bytes: Uint8Array): void {
    this.assertLive();
    if (bytes.byteLength === 0) return;
    this.replyChunks.length = 0;
    this.replyBytes = 0;
    this.replyOverflow = false;
    this.ensureInputCapacity(bytes.byteLength);
    new Uint8Array(
      this.exports.memory.buffer,
      this.inputPointer,
      bytes.byteLength,
    ).set(bytes);
    this.exports.ghostty_terminal_vt_write(
      this.terminal,
      this.inputPointer,
      bytes.byteLength,
    );

    const overflow = this.replyOverflow;
    try {
      for (const reply of this.replyChunks) this.options.onReply?.(reply);
    } finally {
      this.replyChunks.length = 0;
      this.replyBytes = 0;
    }
    if (overflow) {
      throw new Error(
        `libghostty exceeded the ${MAX_REPLY_BYTES_PER_WRITE}-byte reply budget`,
      );
    }
  }

  resize(
    cols: number,
    rows: number,
    cellWidthPx = this.cellWidthPx,
    cellHeightPx = this.cellHeightPx,
  ): void {
    this.assertLive();
    validateDimensions(cols, rows);
    assertResult(
      this.exports.ghostty_terminal_resize(
        this.terminal,
        cols,
        rows,
        Math.max(0, Math.round(cellWidthPx)),
        Math.max(0, Math.round(cellHeightPx)),
      ),
      "ghostty_terminal_resize",
    );
    this._cols = cols;
    this._rows = rows;
    this.cellWidthPx = cellWidthPx;
    this.cellHeightPx = cellHeightPx;
  }

  updateRenderState(): GhosttyRenderStateDirty {
    this.assertLive();
    assertResult(
      this.exports.ghostty_render_state_update(this.renderState, this.terminal),
      "ghostty_render_state_update",
    );
    return this.getRenderI32(GhosttyRenderStateData.Dirty);
  }

  cursor(): OfficialGhosttyRenderCursor {
    this.assertLive();
    const hasViewport = this.getRenderBool(
      GhosttyRenderStateData.CursorViewportHasValue,
    );
    return {
      x: hasViewport
        ? this.getRenderU16(GhosttyRenderStateData.CursorViewportX)
        : 0,
      y: hasViewport
        ? this.getRenderU16(GhosttyRenderStateData.CursorViewportY)
        : 0,
      visible:
        hasViewport && this.getRenderBool(GhosttyRenderStateData.CursorVisible),
      blinking: this.getRenderBool(GhosttyRenderStateData.CursorBlinking),
      style: this.getRenderI32(
        GhosttyRenderStateData.CursorVisualStyle,
      ) as GhosttyRenderStateCursorStyle,
    };
  }

  colors(): OfficialGhosttyRenderColors {
    this.assertLive();
    const layout = this.abi.struct("GhosttyRenderStateColors");
    if (layout.size > this.scratchBytes) {
      throw new Error("GhosttyRenderStateColors exceeds the scratch buffer");
    }
    const bytes = new Uint8Array(
      this.exports.memory.buffer,
      this.scratch,
      layout.size,
    );
    bytes.fill(0);
    const sizeField = this.abi.field("GhosttyRenderStateColors", "size");
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      sizeField.offset,
      layout.size,
      true,
    );
    assertResult(
      this.exports.ghostty_render_state_colors_get(
        this.renderState,
        this.scratch,
      ),
      "ghostty_render_state_colors_get",
    );

    const backgroundOffset = this.abi.field(
      "GhosttyRenderStateColors",
      "background",
    ).offset;
    const foregroundOffset = this.abi.field(
      "GhosttyRenderStateColors",
      "foreground",
    ).offset;
    const cursorOffset = this.abi.field(
      "GhosttyRenderStateColors",
      "cursor",
    ).offset;
    const cursorHasValueOffset = this.abi.field(
      "GhosttyRenderStateColors",
      "cursor_has_value",
    ).offset;
    const paletteOffset = this.abi.field(
      "GhosttyRenderStateColors",
      "palette",
    ).offset;
    const palette: OfficialGhosttyColor[] = [];
    for (let index = 0; index < 256; index += 1) {
      palette.push(readRgb(bytes, paletteOffset + index * 3));
    }
    return {
      background: readRgb(bytes, backgroundOffset),
      foreground: readRgb(bytes, foregroundOffset),
      cursor: bytes[cursorHasValueOffset] ? readRgb(bytes, cursorOffset) : null,
      palette,
    };
  }

  forEachRawRow(visitor: (row: OfficialGhosttyRawRow) => void): void {
    this.assertLive();
    assertResult(
      this.exports.ghostty_render_state_get(
        this.renderState,
        GhosttyRenderStateData.RowIterator,
        this.rowIteratorSlot,
      ),
      "populate render-state row iterator",
    );

    let row = 0;
    while (
      this.exports.ghostty_render_state_row_iterator_next(this.rowIterator)
    ) {
      assertResult(
        this.exports.ghostty_render_state_row_get(
          this.rowIterator,
          GhosttyRenderStateRowData.Dirty,
          this.scratch,
        ),
        "read render-state row dirty flag",
      );
      const dirty =
        new Uint8Array(this.exports.memory.buffer, this.scratch, 1)[0] !== 0;
      assertResult(
        this.exports.ghostty_render_state_row_get(
          this.rowIterator,
          GhosttyRenderStateRowData.CellsRaw,
          this.scratch,
        ),
        "read render-state raw cells",
      );
      const memory = new DataView(this.exports.memory.buffer);
      const pointer = memory.getUint32(this.scratch, true);
      const length = memory.getUint32(this.scratch + 4, true);
      if (length > this._cols || pointer + length * 8 > memory.byteLength) {
        throw new Error("libghostty returned an invalid raw cell view");
      }
      visitor({
        row,
        dirty,
        cells: new Uint32Array(this.exports.memory.buffer, pointer, length * 2),
      });
      row += 1;
    }
    if (row !== this._rows) {
      throw new Error(
        `libghostty returned ${row} render rows for a ${this._rows}-row terminal`,
      );
    }
  }

  markRenderStateClean(): void {
    this.assertLive();
    const view = new DataView(this.exports.memory.buffer);
    view.setInt32(this.scratch, GhosttyRenderStateDirty.None, true);
    assertResult(
      this.exports.ghostty_render_state_set(this.renderState, 0, this.scratch),
      "clear render-state dirty flag",
    );
    assertResult(
      this.exports.ghostty_render_state_get(
        this.renderState,
        GhosttyRenderStateData.RowIterator,
        this.rowIteratorSlot,
      ),
      "populate render-state row iterator",
    );
    new Uint8Array(this.exports.memory.buffer, this.scratch, 1)[0] = 0;
    while (
      this.exports.ghostty_render_state_row_iterator_next(this.rowIterator)
    ) {
      assertResult(
        this.exports.ghostty_render_state_row_set(
          this.rowIterator,
          0,
          this.scratch,
        ),
        "clear render-state row dirty flag",
      );
    }
  }

  scrollbackRows(): number {
    this.assertLive();
    return this.getTerminalU32(GhosttyTerminalData.ScrollbackRows);
  }

  mode(mode: number, ansi = false): boolean {
    this.assertLive();
    if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0x7fff) return false;
    const layout = this.abi.struct("GhosttyTerminalModeConfig");
    const modeField = this.abi.field("GhosttyTerminalModeConfig", "mode");
    const valueField = this.abi.field("GhosttyTerminalModeConfig", "value");
    const bytes = new Uint8Array(
      this.exports.memory.buffer,
      this.scratch,
      layout.size,
    );
    bytes.fill(0);
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(
      modeField.offset,
      mode | (ansi ? 0x8000 : 0),
      true,
    );
    const result = this.exports.ghostty_terminal_get(
      this.terminal,
      GhosttyTerminalData.Mode,
      this.scratch,
    );
    return result === GhosttyResult.Success && bytes[valueField.offset] !== 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.inputPointer) {
      this.exports.ghostty_wasm_free_u8_array(
        this.inputPointer,
        this.inputCapacity,
      );
      this.inputPointer = 0;
      this.inputCapacity = 0;
    }
    if (this.rowIterator) {
      this.exports.ghostty_render_state_row_iterator_free(this.rowIterator);
      this.rowIterator = 0;
    }
    if (this.renderState) {
      this.exports.ghostty_render_state_free(this.renderState);
      this.renderState = 0;
    }
    if (this.terminal) {
      this.callbacks.unregister(this.terminal);
      this.exports.ghostty_terminal_free(this.terminal);
      this.terminal = 0;
    }
    if (this.scratch) {
      this.exports.ghostty_wasm_free_u8_array(this.scratch, this.scratchBytes);
      this.scratch = 0;
    }
    if (this.rowIteratorSlot) {
      this.exports.ghostty_wasm_free_opaque(this.rowIteratorSlot);
      this.rowIteratorSlot = 0;
    }
    if (this.renderStateSlot) {
      this.exports.ghostty_wasm_free_opaque(this.renderStateSlot);
      this.renderStateSlot = 0;
    }
    if (this.terminalSlot) {
      this.exports.ghostty_wasm_free_opaque(this.terminalSlot);
      this.terminalSlot = 0;
    }
    this.replyChunks.length = 0;
  }

  private configure(options: OfficialGhosttyTerminalOptions): void {
    this.setU32Option(
      GhosttyTerminalOption.ScrollbackMaxLines,
      options.scrollbackMaxLines ?? DEFAULT_SCROLLBACK_LINES,
    );
    this.setU32Option(
      GhosttyTerminalOption.ScrollbackMaxBytes,
      options.scrollbackMaxBytes ?? DEFAULT_SCROLLBACK_BYTES,
    );
    this.setU32Option(
      GhosttyTerminalOption.ContinuationMaxBytes,
      options.continuationMaxBytes ?? DEFAULT_CONTINUATION_BYTES,
    );
    this.setRgbOption(
      GhosttyTerminalOption.ColorForeground,
      options.foreground,
    );
    this.setRgbOption(
      GhosttyTerminalOption.ColorBackground,
      options.background,
    );
    this.setRgbOption(GhosttyTerminalOption.ColorCursor, options.cursor);
    if (options.palette) this.setPalette(options.palette);
    this.setU32Option(
      GhosttyTerminalOption.DefaultCursorStyle,
      encodeCursorStyle(options.cursorStyle ?? "block"),
    );
    this.setBoolOption(
      GhosttyTerminalOption.DefaultCursorBlink,
      options.cursorBlink ?? false,
    );
    this.setStringOption(
      GhosttyTerminalOption.TerminfoName,
      options.terminfoName ?? DEFAULT_TERMINFO_NAME,
    );
  }

  private setU32Option(option: GhosttyTerminalOption, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new Error(`Invalid libghostty option ${option}: ${value}`);
    }
    new DataView(this.exports.memory.buffer).setUint32(
      this.scratch,
      value,
      true,
    );
    assertResult(
      this.exports.ghostty_terminal_set(this.terminal, option, this.scratch),
      `set terminal option ${option}`,
    );
  }

  private setBoolOption(option: GhosttyTerminalOption, value: boolean): void {
    new Uint8Array(this.exports.memory.buffer, this.scratch, 1)[0] = value
      ? 1
      : 0;
    assertResult(
      this.exports.ghostty_terminal_set(this.terminal, option, this.scratch),
      `set terminal option ${option}`,
    );
  }

  private setRgbOption(
    option: GhosttyTerminalOption,
    value: OfficialGhosttyColor | undefined,
  ): void {
    if (!value) return;
    const bytes = new Uint8Array(this.exports.memory.buffer, this.scratch, 3);
    bytes.set(value);
    assertResult(
      this.exports.ghostty_terminal_set(this.terminal, option, this.scratch),
      `set terminal option ${option}`,
    );
  }

  private setPalette(palette: readonly OfficialGhosttyColor[]): void {
    if (palette.length !== 256) {
      throw new Error("libghostty palette must contain exactly 256 colors");
    }
    const bytes = new Uint8Array(this.exports.memory.buffer, this.scratch, 768);
    for (let index = 0; index < palette.length; index += 1) {
      bytes.set(palette[index], index * 3);
    }
    assertResult(
      this.exports.ghostty_terminal_set(
        this.terminal,
        GhosttyTerminalOption.ColorPalette,
        this.scratch,
      ),
      "set terminal palette",
    );
  }

  private setStringOption(option: GhosttyTerminalOption, value: string): void {
    const bytes = new TextEncoder().encode(value);
    const data = allocateBytes(this.exports, bytes.byteLength);
    try {
      new Uint8Array(this.exports.memory.buffer, data, bytes.byteLength).set(
        bytes,
      );
      const layout = this.abi.struct("GhosttyString");
      const pointerField = this.abi.field("GhosttyString", "ptr");
      const lengthField = this.abi.field("GhosttyString", "len");
      if (layout.size > this.scratchBytes) {
        throw new Error("GhosttyString exceeds the scratch buffer");
      }
      const view = new DataView(this.exports.memory.buffer);
      new Uint8Array(
        this.exports.memory.buffer,
        this.scratch,
        layout.size,
      ).fill(0);
      view.setUint32(this.scratch + pointerField.offset, data, true);
      view.setUint32(this.scratch + lengthField.offset, bytes.byteLength, true);
      assertResult(
        this.exports.ghostty_terminal_set(this.terminal, option, this.scratch),
        `set terminal option ${option}`,
      );
    } finally {
      this.exports.ghostty_wasm_free_u8_array(data, bytes.byteLength);
    }
  }

  private enqueueReply(bytes: Uint8Array): void {
    if (this.replyOverflow || bytes.byteLength === 0) return;
    if (this.replyBytes + bytes.byteLength > MAX_REPLY_BYTES_PER_WRITE) {
      this.replyOverflow = true;
      return;
    }
    this.replyChunks.push(bytes.slice());
    this.replyBytes += bytes.byteLength;
  }

  private getRenderBool(data: GhosttyRenderStateData): boolean {
    assertResult(
      this.exports.ghostty_render_state_get(
        this.renderState,
        data,
        this.scratch,
      ),
      `read render-state field ${data}`,
    );
    return new Uint8Array(this.exports.memory.buffer, this.scratch, 1)[0] !== 0;
  }

  private getRenderU16(data: GhosttyRenderStateData): number {
    assertResult(
      this.exports.ghostty_render_state_get(
        this.renderState,
        data,
        this.scratch,
      ),
      `read render-state field ${data}`,
    );
    return new DataView(this.exports.memory.buffer).getUint16(
      this.scratch,
      true,
    );
  }

  private getRenderI32(data: GhosttyRenderStateData): number {
    assertResult(
      this.exports.ghostty_render_state_get(
        this.renderState,
        data,
        this.scratch,
      ),
      `read render-state field ${data}`,
    );
    return new DataView(this.exports.memory.buffer).getInt32(
      this.scratch,
      true,
    );
  }

  private getTerminalU32(data: GhosttyTerminalData): number {
    assertResult(
      this.exports.ghostty_terminal_get(this.terminal, data, this.scratch),
      `read terminal field ${data}`,
    );
    return new DataView(this.exports.memory.buffer).getUint32(
      this.scratch,
      true,
    );
  }

  private ensureInputCapacity(length: number): void {
    if (length <= this.inputCapacity) return;
    if (this.inputPointer) {
      this.exports.ghostty_wasm_free_u8_array(
        this.inputPointer,
        this.inputCapacity,
      );
    }
    this.inputCapacity = nextPowerOfTwo(length);
    this.inputPointer = allocateBytes(this.exports, this.inputCapacity);
  }

  private assertLive(): void {
    if (this.disposed || !this.terminal) {
      throw new Error("Official libghostty terminal is disposed");
    }
  }
}

function readBuildInfo(
  exports: OfficialGhosttyWasmExports,
  abi: OfficialGhosttyAbi,
): OfficialGhosttyBuildInfo {
  const scratchBytes = Math.max(8, abi.struct("GhosttyString").size);
  const scratch = allocateBytes(exports, scratchBytes);
  try {
    const view = new DataView(exports.memory.buffer);
    assertResult(
      exports.ghostty_build_info(GhosttyBuildInfoKey.Optimize, scratch),
      "read libghostty optimization mode",
    );
    const optimize = view.getInt32(scratch, true) as GhosttyOptimizeMode;
    assertResult(
      exports.ghostty_build_info(GhosttyBuildInfoKey.Simd, scratch),
      "read libghostty SIMD support",
    );
    const simd = new Uint8Array(exports.memory.buffer, scratch, 1)[0] !== 0;
    assertResult(
      exports.ghostty_build_info(GhosttyBuildInfoKey.VersionString, scratch),
      "read libghostty version",
    );
    const stringLayout = abi.struct("GhosttyString");
    const pointerOffset = abi.field("GhosttyString", "ptr").offset;
    const lengthOffset = abi.field("GhosttyString", "len").offset;
    if (stringLayout.size > scratchBytes) {
      throw new Error("GhosttyString exceeds the build-info scratch buffer");
    }
    const pointer = view.getUint32(scratch + pointerOffset, true);
    const length = view.getUint32(scratch + lengthOffset, true);
    if (pointer + length > exports.memory.buffer.byteLength) {
      throw new Error("libghostty returned an invalid build version string");
    }
    const version = new TextDecoder().decode(
      new Uint8Array(exports.memory.buffer, pointer, length),
    );
    return { optimize, simd, version };
  } finally {
    exports.ghostty_wasm_free_u8_array(scratch, scratchBytes);
  }
}

function validateExports(
  exports: WebAssembly.Exports,
): OfficialGhosttyWasmExports {
  const required = [
    "memory",
    "__indirect_function_table",
    "ghostty_type_json",
    "ghostty_terminal_new",
    "ghostty_terminal_set",
    "ghostty_terminal_vt_write",
    "ghostty_render_state_new",
    "ghostty_render_state_update",
    "ghostty_render_state_get",
    "ghostty_render_state_row_get",
  ] as const;
  for (const name of required) {
    if (!(name in exports)) {
      throw new Error(`Official libghostty is missing export ${name}`);
    }
  }
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("Official libghostty exported an invalid memory object");
  }
  if (!(exports.__indirect_function_table instanceof WebAssembly.Table)) {
    throw new Error("Official libghostty exported an invalid function table");
  }
  return exports as OfficialGhosttyWasmExports;
}

function allocateOpaque(exports: OfficialGhosttyWasmExports): number {
  const pointer = exports.ghostty_wasm_alloc_opaque();
  if (!pointer) throw new Error("libghostty failed to allocate an opaque slot");
  return pointer;
}

function allocateBytes(
  exports: OfficialGhosttyWasmExports,
  length: number,
): number {
  if (length === 0) return 0;
  const pointer = exports.ghostty_wasm_alloc_u8_array(length);
  if (!pointer)
    throw new Error(`libghostty failed to allocate ${length} bytes`);
  return pointer;
}

function readPointer(memory: WebAssembly.Memory, pointer: number): number {
  return new DataView(memory.buffer).getUint32(pointer, true);
}

function assertResult(result: number, operation: string): void {
  if (result !== GhosttyResult.Success) {
    throw new Error(`${operation} failed with GhosttyResult ${result}`);
  }
}

function validateDimensions(cols: number, rows: number): void {
  if (
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    cols <= 0 ||
    rows <= 0 ||
    cols > 4096 ||
    rows > 4096 ||
    cols * rows > 1_048_576
  ) {
    throw new Error(`Invalid terminal dimensions ${cols}x${rows}`);
  }
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function encodeCursorStyle(
  style: NonNullable<OfficialGhosttyTerminalOptions["cursorStyle"]>,
): GhosttyRenderStateCursorStyle {
  if (style === "bar") return GhosttyRenderStateCursorStyle.Bar;
  if (style === "underline") return GhosttyRenderStateCursorStyle.Underline;
  return GhosttyRenderStateCursorStyle.Block;
}

function readRgb(bytes: Uint8Array, offset: number): OfficialGhosttyColor {
  return [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
}
