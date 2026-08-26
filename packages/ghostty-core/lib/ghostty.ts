/**
 * TypeScript wrapper for libghostty-vt WASM API
 *
 * High-performance terminal emulation using Ghostty's battle-tested VT100 parser.
 * The key optimization is the RenderState API which provides a pre-computed
 * snapshot of all render data in a single update call.
 */

import {
  CellFlags,
  type Cursor,
  DirtyState,
  GHOSTTY_CONFIG_SIZE,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type GhosttyTerminalEvent,
  type GhosttyWasmExports,
  KeyEncoderOption,
  type KeyEvent,
  type KittyKeyFlags,
  type PackedViewport,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
  type TerminalHandle,
} from './types';

// Re-export types for convenience
export {
  CellFlags,
  type Cursor,
  DirtyState,
  type GhosttyCell,
  type GhosttyTerminalConfig,
  type GhosttyTerminalEvent,
  KeyEncoderOption,
  type RGB,
  type RenderStateColors,
  type RenderStateCursor,
};

/**
 * Main Ghostty WASM wrapper class
 */
export class Ghostty {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;

  constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as GhosttyWasmExports;
    this.memory = this.exports.memory;
  }

  createKeyEncoder(): KeyEncoder {
    return new KeyEncoder(this.exports);
  }

  createTerminal(
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ): GhosttyTerminal {
    return new GhosttyTerminal(this.exports, this.memory, cols, rows, config);
  }

  getMemoryBytes(): number {
    return this.memory.buffer.byteLength;
  }

  static async load(wasmPath?: string): Promise<Ghostty> {
    const path = wasmPath ?? new URL('../ghostty-vt.wasm', import.meta.url).href;
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch Ghostty WASM: ${response.status} ${response.statusText}`);
    }
    const fallback = response.clone();
    let memory: WebAssembly.Memory | null = null;
    const imports = Ghostty.createImports(() => memory);
    try {
      const { instance } = await WebAssembly.instantiateStreaming(response, imports);
      memory = (instance.exports as GhosttyWasmExports).memory;
      return new Ghostty(instance);
    } catch {
      return Ghostty.loadBytes(await fallback.arrayBuffer());
    }
  }

  static async loadBytes(wasmBytes: ArrayBuffer): Promise<Ghostty> {
    if (wasmBytes.byteLength === 0) throw new Error('Ghostty WASM is empty');
    let memory: WebAssembly.Memory | null = null;
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const wasmInstance = await WebAssembly.instantiate(
      wasmModule,
      Ghostty.createImports(() => memory)
    );
    memory = (wasmInstance.exports as GhosttyWasmExports).memory;
    return new Ghostty(wasmInstance);
  }

  private static createImports(
    getMemory: () => WebAssembly.Memory | null
  ): WebAssembly.Imports {
    return {
      env: {
        log: (ptr: number, len: number) => {
          const memory = getMemory();
          if (!memory) return;
          const bytes = new Uint8Array(memory.buffer, ptr, len);
          console.log('[ghostty-vt]', new TextDecoder().decode(bytes));
        },
      },
    };
  }
}

/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export class KeyEncoder {
  private exports: GhosttyWasmExports;
  private encoder: number = 0;
  private event: number = 0;
  private outputBufferPtr: number = 0;
  private readonly outputBufferSize = 64;
  private writtenPtr: number = 0;
  private optionPtr: number = 0;
  private utf8BufferPtr: number = 0;
  private utf8BufferSize: number = 0;
  private readonly textEncoder = new TextEncoder();

  constructor(exports: GhosttyWasmExports) {
    this.exports = exports;
    const encoderPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    try {
      const result = this.exports.ghostty_key_encoder_new(0, encoderPtrPtr);
      if (result !== 0) throw new Error(`Failed to create key encoder: ${result}`);
      this.encoder = new DataView(this.exports.memory.buffer).getUint32(
        encoderPtrPtr,
        true
      );
    } finally {
      this.exports.ghostty_wasm_free_opaque(encoderPtrPtr);
    }

    try {
      const eventPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
      try {
        const result = this.exports.ghostty_key_event_new(0, eventPtrPtr);
        if (result !== 0) throw new Error(`Failed to create key event: ${result}`);
        this.event = new DataView(this.exports.memory.buffer).getUint32(
          eventPtrPtr,
          true
        );
      } finally {
        this.exports.ghostty_wasm_free_opaque(eventPtrPtr);
      }
      this.outputBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(
        this.outputBufferSize
      );
      this.writtenPtr = this.exports.ghostty_wasm_alloc_usize();
      this.optionPtr = this.exports.ghostty_wasm_alloc_u8();
      if (!this.outputBufferPtr || !this.writtenPtr || !this.optionPtr) {
        throw new Error('Failed to allocate key encoder buffers');
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  setOption(option: KeyEncoderOption, value: boolean | number): void {
    const view = new DataView(this.exports.memory.buffer);
    view.setUint8(
      this.optionPtr,
      typeof value === 'boolean' ? (value ? 1 : 0) : value
    );
    this.exports.ghostty_key_encoder_setopt(this.encoder, option, this.optionPtr);
  }

  setKittyFlags(flags: KittyKeyFlags): void {
    this.setOption(KeyEncoderOption.KITTY_KEYBOARD_FLAGS, flags);
  }

  encode(event: KeyEvent): Uint8Array {
    if (!this.encoder || !this.event) throw new Error('Key encoder has been disposed');
    this.exports.ghostty_key_event_set_action(this.event, event.action);
    this.exports.ghostty_key_event_set_key(this.event, event.key);
    this.exports.ghostty_key_event_set_mods(this.event, event.mods);

    if (event.utf8) {
      const utf8Bytes = this.textEncoder.encode(event.utf8);
      this.ensureUtf8Buffer(utf8Bytes.length);
      new Uint8Array(this.exports.memory.buffer, this.utf8BufferPtr, utf8Bytes.length).set(
        utf8Bytes
      );
      this.exports.ghostty_key_event_set_utf8(
        this.event,
        this.utf8BufferPtr,
        utf8Bytes.length
      );
    } else {
      this.exports.ghostty_key_event_set_utf8(this.event, 0, 0);
    }

    const encodeResult = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      this.event,
      this.outputBufferPtr,
      this.outputBufferSize,
      this.writtenPtr
    );

    if (encodeResult !== 0) {
      throw new Error(`Failed to encode key: ${encodeResult}`);
    }

    const bytesWritten = new DataView(this.exports.memory.buffer).getUint32(
      this.writtenPtr,
      true
    );
    return new Uint8Array(
      this.exports.memory.buffer,
      this.outputBufferPtr,
      bytesWritten
    ).slice();
  }

  dispose(): void {
    if (this.utf8BufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.utf8BufferPtr,
        this.utf8BufferSize
      );
      this.utf8BufferPtr = 0;
      this.utf8BufferSize = 0;
    }
    if (this.optionPtr) {
      this.exports.ghostty_wasm_free_u8(this.optionPtr);
      this.optionPtr = 0;
    }
    if (this.writtenPtr) {
      this.exports.ghostty_wasm_free_usize(this.writtenPtr);
      this.writtenPtr = 0;
    }
    if (this.outputBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.outputBufferPtr,
        this.outputBufferSize
      );
      this.outputBufferPtr = 0;
    }
    if (this.event) {
      this.exports.ghostty_key_event_free(this.event);
      this.event = 0;
    }
    if (this.encoder) {
      this.exports.ghostty_key_encoder_free(this.encoder);
      this.encoder = 0;
    }
  }

  private ensureUtf8Buffer(bytes: number): void {
    if (bytes <= this.utf8BufferSize) return;
    if (this.utf8BufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.utf8BufferPtr,
        this.utf8BufferSize
      );
    }
    this.utf8BufferSize = nextPowerOfTwo(bytes);
    this.utf8BufferPtr = this.exports.ghostty_wasm_alloc_u8_array(
      this.utf8BufferSize
    );
    if (!this.utf8BufferPtr) throw new Error('Failed to allocate key input buffer');
  }
}

/**
 * GhosttyTerminal - High-performance terminal emulator
 *
 * Uses Ghostty's native RenderState for optimal performance:
 * - ONE call to update all state (renderStateUpdate)
 * - ONE call to get all cells (getViewport)
 * - No per-row WASM boundary crossings!
 */
export class GhosttyTerminal {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;
  private handle: TerminalHandle;
  private _cols: number;
  private _rows: number;
  private inputBufferPtr: number = 0;
  private inputBufferSize: number = 0;
  private responseBufferPtr: number = 0;
  private readonly responseBufferSize: number = 256;
  private eventBufferPtr: number = 0;
  private readonly eventBufferSize: number = 64 * 1024;
  private readonly eventDecoder = new TerminalEventDecoder();
  private hyperlinkBufferPtr: number = 0;
  private hyperlinkBufferSize: number = 0;
  private disposed = false;

  /** Size of GhosttyCell in WASM (16 bytes) */
  private static readonly CELL_SIZE = 16;

  /** Reusable buffer for viewport operations */
  private viewportBufferPtr: number = 0;
  private viewportBufferSize: number = 0;

  /** Cell pool for zero-allocation rendering */
  private cellPool: GhosttyCell[] = [];

  constructor(
    exports: GhosttyWasmExports,
    memory: WebAssembly.Memory,
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ) {
    this.exports = exports;
    this.memory = memory;
    this._cols = cols;
    this._rows = rows;

    if (config) {
      // Allocate config struct in WASM memory
      const configPtr = this.exports.ghostty_wasm_alloc_u8_array(GHOSTTY_CONFIG_SIZE);
      if (configPtr === 0) {
        throw new Error('Failed to allocate config (out of memory)');
      }

      try {
        // Write config to WASM memory
        const view = new DataView(this.memory.buffer);
        let offset = configPtr;

        // scrollback_limit (u32)
        view.setUint32(offset, config.scrollbackLimit ?? 10000, true);
        offset += 4;

        // fg_color (u32)
        view.setUint32(offset, config.fgColor ?? 0, true);
        offset += 4;

        // bg_color (u32)
        view.setUint32(offset, config.bgColor ?? 0, true);
        offset += 4;

        // cursor_color (u32)
        view.setUint32(offset, config.cursorColor ?? 0, true);
        offset += 4;

        // palette[16] (u32 * 16)
        for (let i = 0; i < 16; i++) {
          view.setUint32(offset, config.palette?.[i] ?? 0, true);
          offset += 4;
        }

        view.setUint8(offset, encodeCursorStyle(config.cursorStyle ?? 'block'));
        offset += 1;
        view.setUint8(offset, config.cursorBlink ? 1 : 0);
        offset += 1;
        view.setUint16(offset, 0, true);

        this.handle = this.exports.ghostty_terminal_new_with_config(cols, rows, configPtr);
      } finally {
        // Free the config memory
        this.exports.ghostty_wasm_free_u8_array(configPtr, GHOSTTY_CONFIG_SIZE);
      }
    } else {
      this.handle = this.exports.ghostty_terminal_new(cols, rows);
    }

    if (!this.handle) throw new Error('Failed to create terminal');

    this.ensureGraphemeBuffer();
    this.initCellPool();
  }

  get cols(): number {
    return this._cols;
  }
  get rows(): number {
    return this._rows;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  write(data: string | Uint8Array): void {
    if (this.disposed) throw new Error('Terminal has been freed');
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (bytes.length === 0) return;
    if (bytes.length > this.inputBufferSize) {
      if (this.inputBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.inputBufferPtr, this.inputBufferSize);
      }
      this.inputBufferSize = nextPowerOfTwo(bytes.length);
      this.inputBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(this.inputBufferSize);
      if (!this.inputBufferPtr) throw new Error('Failed to allocate terminal input buffer');
    }
    new Uint8Array(this.memory.buffer, this.inputBufferPtr, bytes.length).set(bytes);
    this.exports.ghostty_terminal_write(this.handle, this.inputBufferPtr, bytes.length);
  }

  resize(cols: number, rows: number): void {
    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    this.exports.ghostty_terminal_resize(this.handle, cols, rows);
    this.invalidateBuffers();
    this.ensureGraphemeBuffer();
    this.initCellPool();
  }

  free(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.inputBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.inputBufferPtr, this.inputBufferSize);
      this.inputBufferPtr = 0;
      this.inputBufferSize = 0;
    }
    if (this.viewportBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      this.viewportBufferPtr = 0;
    }
    if (this.responseBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.responseBufferPtr,
        this.responseBufferSize
      );
      this.responseBufferPtr = 0;
    }
    if (this.eventBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.eventBufferPtr,
        this.eventBufferSize
      );
      this.eventBufferPtr = 0;
    }
    if (this.hyperlinkBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.hyperlinkBufferPtr,
        this.hyperlinkBufferSize
      );
      this.hyperlinkBufferPtr = 0;
      this.hyperlinkBufferSize = 0;
    }
    if (this.graphemeBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.graphemeBufferPtr, 16 * 4);
      this.graphemeBufferPtr = 0;
      this.graphemeBuffer = null;
    }
    this.exports.ghostty_terminal_free(this.handle);
  }

  // ==========================================================================
  // RenderState API - The key performance optimization
  // ==========================================================================

  /**
   * Update render state from terminal.
   *
   * This syncs the RenderState with the current Terminal state.
   * The dirty state (full/partial/none) is stored in the WASM RenderState
   * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
   * returns true for ALL rows.
   *
   * The WASM layer automatically detects screen switches (normal <-> alternate)
   * and returns FULL dirty state when switching screens (e.g., vim exit).
   *
   * Safe to call multiple times - dirty state persists until markClean().
   */
  update(): DirtyState {
    return this.exports.ghostty_render_state_update(this.handle) as DirtyState;
  }

  /**
   * Get cursor state from render state.
   * Ensures render state is fresh by calling update().
   */
  getCursor(): RenderStateCursor {
    this.update();
    return this.getCursorSnapshot();
  }

  getCursorSnapshot(): RenderStateCursor {
    return {
      x: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      y: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      viewportX: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      viewportY: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      visible: !!this.exports.ghostty_render_state_get_cursor_visible(this.handle),
      blinking: !!this.exports.ghostty_render_state_get_cursor_blinking(this.handle),
      style: decodeCursorStyle(
        this.exports.ghostty_render_state_get_cursor_style(this.handle)
      ),
    };
  }

  /**
   * Get default colors from render state
   */
  getColors(): RenderStateColors {
    const bg = this.exports.ghostty_render_state_get_bg_color(this.handle);
    const fg = this.exports.ghostty_render_state_get_fg_color(this.handle);
    return {
      background: {
        r: (bg >> 16) & 0xff,
        g: (bg >> 8) & 0xff,
        b: bg & 0xff,
      },
      foreground: {
        r: (fg >> 16) & 0xff,
        g: (fg >> 8) & 0xff,
        b: fg & 0xff,
      },
      cursor: null, // TODO: Add cursor color support
    };
  }

  /**
   * Check if a specific row is dirty
   */
  isRowDirty(y: number): boolean {
    return this.exports.ghostty_render_state_is_row_dirty(this.handle, y);
  }

  /**
   * Mark render state as clean (call after rendering)
   */
  markClean(): void {
    this.exports.ghostty_render_state_mark_clean(this.handle);
  }

  /**
   * Get ALL viewport cells in ONE WASM call - the key performance optimization!
   * Returns a reusable cell array (zero allocation after warmup).
   */
  getViewport(): GhosttyCell[] {
    const packed = this.getPackedViewport();
    this.parseCellsIntoPool(packed.bytes.byteOffset, packed.cellCount);
    return this.cellPool;
  }

  getPackedViewport(): PackedViewport {
    const totalCells = this._cols * this._rows;
    const neededSize = totalCells * GhosttyTerminal.CELL_SIZE;

    // Ensure buffer is allocated
    if (!this.viewportBufferPtr || this.viewportBufferSize < neededSize) {
      if (this.viewportBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      }
      this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.viewportBufferSize = neededSize;
    }

    // Get all cells in one call
    const count = this.exports.ghostty_render_state_get_viewport(
      this.handle,
      this.viewportBufferPtr,
      totalCells
    );

    if (count < 0) throw new Error('Failed to read packed terminal viewport');
    return {
      bytes: new Uint8Array(
        this.memory.buffer,
        this.viewportBufferPtr,
        count * GhosttyTerminal.CELL_SIZE
      ),
      cellCount: count,
      cellStride: GhosttyTerminal.CELL_SIZE,
      cols: this._cols,
      rows: this._rows,
    };
  }

  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================

  /**
   * Get line - for compatibility, extracts from viewport.
   * Ensures render state is fresh by calling update().
   * Returns a COPY of the cells to avoid pool reference issues.
   */
  getLine(y: number): GhosttyCell[] | null {
    if (y < 0 || y >= this._rows) return null;
    // Call update() to ensure render state is fresh.
    // This is safe to call multiple times - dirty state persists until markClean().
    this.update();
    return this.getLineSnapshot(y);
  }

  /** Read one active-screen line from the caller's current RenderState. */
  getLineSnapshot(y: number): GhosttyCell[] | null {
    if (y < 0 || y >= this._rows) return null;
    const viewport = this.getViewport();
    const start = y * this._cols;
    // Return deep copies to avoid cell pool reference issues
    return viewport.slice(start, start + this._cols).map((cell) => ({ ...cell }));
  }

  /** For compatibility with old API */
  isDirty(): boolean {
    return this.update() !== DirtyState.NONE;
  }

  /**
   * Check if a full redraw is needed (screen change, resize, etc.)
   * Note: This calls update() to ensure fresh state. Safe to call multiple times.
   */
  needsFullRedraw(): boolean {
    return this.update() === DirtyState.FULL;
  }

  /** Mark render state as clean after rendering */
  clearDirty(): void {
    this.markClean();
  }

  // ==========================================================================
  // Terminal modes
  // ==========================================================================

  isAlternateScreen(): boolean {
    return !!this.exports.ghostty_terminal_is_alternate_screen(this.handle);
  }

  hasBracketedPaste(): boolean {
    // Mode 2004 = bracketed paste (DEC mode)
    return this.getMode(2004, false);
  }

  hasFocusEvents(): boolean {
    // Mode 1004 = focus events (DEC mode)
    return this.getMode(1004, false);
  }

  hasMouseTracking(): boolean {
    return this.exports.ghostty_terminal_has_mouse_tracking(this.handle) !== 0;
  }

  // ==========================================================================
  // Extended API (scrollback, modes, etc.)
  // ==========================================================================

  /** Get dimensions - for compatibility */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this._cols, rows: this._rows };
  }

  /** Get number of scrollback lines (history, not including active screen) */
  getScrollbackLength(): number {
    return this.exports.ghostty_terminal_get_scrollback_length(this.handle);
  }

  /**
   * Get one scrollback line in the packed 16-byte cell ABI.
   * The bytes are borrowed and remain valid only until the next terminal call.
   */
  getPackedScrollbackLine(offset: number): PackedViewport | null {
    this.update();
    return this.getPackedScrollbackLineSnapshot(offset);
  }

  /**
   * Read one scrollback line after the caller synchronized RenderState.
   * This avoids repeated updates when reading several rows from one snapshot.
   */
  getPackedScrollbackLineSnapshot(offset: number): PackedViewport | null {
    const neededSize = this._cols * GhosttyTerminal.CELL_SIZE;

    if (!this.viewportBufferPtr || this.viewportBufferSize < neededSize) {
      if (this.viewportBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      }
      this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.viewportBufferSize = neededSize;
    }

    const count = this.exports.ghostty_terminal_get_scrollback_line(
      this.handle,
      offset,
      this.viewportBufferPtr,
      this._cols
    );
    if (count < 0) return null;

    return {
      bytes: new Uint8Array(
        this.memory.buffer,
        this.viewportBufferPtr,
        count * GhosttyTerminal.CELL_SIZE
      ),
      cellCount: count,
      cellStride: GhosttyTerminal.CELL_SIZE,
      cols: this._cols,
      rows: 1,
    };
  }

  /**
   * Get a line from the scrollback buffer.
   * Ensures render state is fresh by calling update().
   * @param offset 0 = oldest line, (length-1) = most recent scrollback line
   */
  getScrollbackLine(offset: number): GhosttyCell[] | null {
    this.update();
    return this.getScrollbackLineSnapshot(offset);
  }

  /** Read a parsed scrollback line from the caller's current snapshot. */
  getScrollbackLineSnapshot(offset: number): GhosttyCell[] | null {
    const packed = this.getPackedScrollbackLineSnapshot(offset);
    if (!packed) return null;

    // Parse cells
    const cells: GhosttyCell[] = [];
    const buffer = this.memory.buffer;
    const u8 = packed.bytes;
    const view = new DataView(buffer, packed.bytes.byteOffset, packed.bytes.byteLength);

    for (let i = 0; i < packed.cellCount; i++) {
      const cellOffset = i * GhosttyTerminal.CELL_SIZE;
      cells.push({
        codepoint: view.getUint32(cellOffset, true),
        fg_r: u8[cellOffset + 4],
        fg_g: u8[cellOffset + 5],
        fg_b: u8[cellOffset + 6],
        bg_r: u8[cellOffset + 7],
        bg_g: u8[cellOffset + 8],
        bg_b: u8[cellOffset + 9],
        flags: u8[cellOffset + 10],
        width: u8[cellOffset + 11],
        hyperlink_id: view.getUint16(cellOffset + 12, true),
        grapheme_len: u8[cellOffset + 14],
      });
    }

    return cells;
  }

  /** Check if a row in the active screen is wrapped (soft-wrapped to next line) */
  isRowWrapped(row: number): boolean {
    return this.exports.ghostty_terminal_is_row_wrapped(this.handle, row) !== 0;
  }

  /** Check if a scrollback row continues the previous logical line. */
  isScrollbackRowWrapped(offset: number): boolean {
    return (
      this.exports.ghostty_terminal_is_scrollback_row_wrapped(
        this.handle,
        offset
      ) !== 0
    );
  }

  /**
   * Get the hyperlink URI for a cell at the given position.
   * @param row Row index (0-based, in active viewport)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getHyperlinkUri(row: number, col: number): string | null {
    // Check if WASM has this function (requires rebuilt WASM with hyperlink support)
    if (!this.exports.ghostty_terminal_get_hyperlink_uri) {
      return null;
    }

    return this.readHyperlinkUri(false, row, col);
  }

  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest, scrollback_len-1 = newest)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getScrollbackHyperlinkUri(offset: number, col: number): string | null {
    // Check if WASM has this function
    if (!this.exports.ghostty_terminal_get_scrollback_hyperlink_uri) {
      return null;
    }

    return this.readHyperlinkUri(true, offset, col);
  }

  /**
   * Check if there are pending responses from the terminal.
   * Responses are generated by escape sequences like DSR (Device Status Report).
   */
  hasResponse(): boolean {
    return this.exports.ghostty_terminal_has_response(this.handle);
  }

  /**
   * Read pending responses from the terminal.
   * Returns the response string, or null if no responses pending.
   *
   * Responses are generated by escape sequences that require replies:
   * - DSR 6 (cursor position): Returns \x1b[row;colR
   * - DSR 5 (operating status): Returns \x1b[0n
   */
  readResponse(): string | null {
    const bytes = this.readResponseBytes();
    return bytes ? terminalTextDecoder.decode(bytes) : null;
  }

  /**
   * Read a terminal-generated response without a UTF-8 decode and re-encode.
   * The returned bytes own their memory and remain valid after this call.
   */
  readResponseBytes(): Uint8Array | null {
    if (!this.hasResponse()) return null;
    if (!this.responseBufferPtr) {
      this.responseBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(
        this.responseBufferSize
      );
      if (!this.responseBufferPtr) {
        throw new Error('Failed to allocate terminal response buffer');
      }
    }
    const bytesRead = this.exports.ghostty_terminal_read_response(
      this.handle,
      this.responseBufferPtr,
      this.responseBufferSize
    );
    if (bytesRead <= 0) return null;
    return new Uint8Array(
      this.memory.buffer,
      this.responseBufferPtr,
      bytesRead
    ).slice();
  }

  /** Drain semantic terminal events in parser order. */
  drainEvents(): GhosttyTerminalEvent[] {
    const events: GhosttyTerminalEvent[] = [];
    if (!this.exports.ghostty_terminal_has_events) return events;
    if (!this.eventBufferPtr) {
      this.eventBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(
        this.eventBufferSize
      );
      if (!this.eventBufferPtr) {
        throw new Error('Failed to allocate terminal event buffer');
      }
    }

    while (this.exports.ghostty_terminal_has_events(this.handle)) {
      const bytesRead = this.exports.ghostty_terminal_read_events(
        this.handle,
        this.eventBufferPtr,
        this.eventBufferSize
      );
      if (bytesRead <= 0) break;
      this.eventDecoder.push(
        new Uint8Array(this.memory.buffer, this.eventBufferPtr, bytesRead),
        events
      );
    }

    const dropped = this.exports.ghostty_terminal_take_dropped_events(
      this.handle
    );
    if (dropped > 0) events.push({ type: 'overflow', dropped });
    return events;
  }

  /**
   * Query arbitrary terminal mode by number
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(mode: number, isAnsi: boolean = false): boolean {
    return this.exports.ghostty_terminal_get_mode(this.handle, mode, isAnsi) !== 0;
  }

  setCursorOptions(
    style: 'block' | 'underline' | 'bar',
    blinking: boolean
  ): void {
    this.exports.ghostty_terminal_set_cursor_style(
      this.handle,
      encodeCursorStyle(style)
    );
    this.exports.ghostty_terminal_set_cursor_blinking(this.handle, blinking);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private initCellPool(): void {
    const total = this._cols * this._rows;
    if (this.cellPool.length < total) {
      for (let i = this.cellPool.length; i < total; i++) {
        this.cellPool.push({
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0,
        });
      }
    }
  }

  private parseCellsIntoPool(ptr: number, count: number): void {
    const buffer = this.memory.buffer;
    const u8 = new Uint8Array(buffer, ptr, count * GhosttyTerminal.CELL_SIZE);
    const view = new DataView(buffer, ptr, count * GhosttyTerminal.CELL_SIZE);

    for (let i = 0; i < count; i++) {
      const offset = i * GhosttyTerminal.CELL_SIZE;
      const cell = this.cellPool[i];
      cell.codepoint = view.getUint32(offset, true);
      cell.fg_r = u8[offset + 4];
      cell.fg_g = u8[offset + 5];
      cell.fg_b = u8[offset + 6];
      cell.bg_r = u8[offset + 7];
      cell.bg_g = u8[offset + 8];
      cell.bg_b = u8[offset + 9];
      cell.flags = u8[offset + 10];
      cell.width = u8[offset + 11];
      cell.hyperlink_id = view.getUint16(offset + 12, true);
      cell.grapheme_len = u8[offset + 14]; // grapheme_len is at byte 14
    }
  }

  /** Small buffer for grapheme lookups (reused to avoid allocation) */
  private graphemeBuffer: Uint32Array | null = null;
  private graphemeBufferPtr: number = 0;

  private ensureGraphemeBuffer(): void {
    if (!this.graphemeBufferPtr) {
      this.graphemeBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(16 * 4);
      if (!this.graphemeBufferPtr) throw new Error('Failed to allocate grapheme buffer');
    }
    if (!this.graphemeBuffer || this.graphemeBuffer.buffer !== this.memory.buffer) {
      this.graphemeBuffer = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, 16);
    }
  }

  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(row: number, col: number): number[] | null {
    this.ensureGraphemeBuffer();

    const count = this.exports.ghostty_render_state_get_grapheme(
      this.handle,
      row,
      col,
      this.graphemeBufferPtr,
      16
    );

    if (count < 0) return null;

    // Re-create view in case memory grew
    const view = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, count);
    return Array.from(view);
  }

  /**
   * Get a string representation of the grapheme at the given position.
   * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
   */
  getGraphemeString(row: number, col: number): string {
    const codepoints = this.getGrapheme(row, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   * @param col Column index
   * @returns Array of codepoints, or null on error
   */
  getScrollbackGrapheme(offset: number, col: number): number[] | null {
    this.ensureGraphemeBuffer();

    const count = this.exports.ghostty_terminal_get_scrollback_grapheme(
      this.handle,
      offset,
      col,
      this.graphemeBufferPtr,
      16
    );

    if (count < 0) return null;

    // Re-create view in case memory grew
    const view = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, count);
    return Array.from(view);
  }

  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(offset: number, col: number): string {
    const codepoints = this.getScrollbackGrapheme(offset, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  private readHyperlinkUri(
    scrollback: boolean,
    rowOrOffset: number,
    col: number
  ): string | null {
    this.ensureHyperlinkBuffer(2048);
    while (this.hyperlinkBufferSize <= MAX_HYPERLINK_URI_BYTES) {
      const bytesWritten = scrollback
        ? this.exports.ghostty_terminal_get_scrollback_hyperlink_uri(
            this.handle,
            rowOrOffset,
            col,
            this.hyperlinkBufferPtr,
            this.hyperlinkBufferSize
          )
        : this.exports.ghostty_terminal_get_hyperlink_uri(
            this.handle,
            rowOrOffset,
            col,
            this.hyperlinkBufferPtr,
            this.hyperlinkBufferSize
          );
      if (bytesWritten === 0) return null;
      if (bytesWritten > 0) {
        return terminalTextDecoder.decode(
          new Uint8Array(
            this.memory.buffer,
            this.hyperlinkBufferPtr,
            bytesWritten
          )
        );
      }
      if (bytesWritten !== -1 || this.hyperlinkBufferSize === MAX_HYPERLINK_URI_BYTES) {
        return null;
      }
      this.ensureHyperlinkBuffer(
        Math.min(MAX_HYPERLINK_URI_BYTES, this.hyperlinkBufferSize * 4)
      );
    }
    return null;
  }

  private ensureHyperlinkBuffer(size: number): void {
    if (this.hyperlinkBufferSize >= size) return;
    if (this.hyperlinkBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.hyperlinkBufferPtr,
        this.hyperlinkBufferSize
      );
    }
    this.hyperlinkBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(size);
    this.hyperlinkBufferSize = size;
    if (!this.hyperlinkBufferPtr) {
      this.hyperlinkBufferSize = 0;
      throw new Error('Failed to allocate terminal hyperlink buffer');
    }
  }

  private invalidateBuffers(): void {
    if (this.viewportBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      this.viewportBufferPtr = 0;
      this.viewportBufferSize = 0;
    }
    if (this.graphemeBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.graphemeBufferPtr, 16 * 4);
      this.graphemeBufferPtr = 0;
    }
    this.graphemeBuffer = null;
  }
}

const TERMINAL_EVENT_HEADER_BYTES = 5;
const MAX_TERMINAL_EVENT_PAYLOAD_BYTES = 1024 * 1024;
const MAX_HYPERLINK_URI_BYTES = 32 * 1024;
const terminalTextDecoder = new TextDecoder();

class TerminalEventDecoder {
  private readonly header = new Uint8Array(TERMINAL_EVENT_HEADER_BYTES);
  private headerOffset = 0;
  private eventType = 0;
  private payload = new Uint8Array(0);
  private payloadOffset = 0;

  push(bytes: Uint8Array, target: GhosttyTerminalEvent[]): void {
    let offset = 0;
    while (offset < bytes.byteLength) {
      if (this.headerOffset < TERMINAL_EVENT_HEADER_BYTES) {
        const count = Math.min(
          TERMINAL_EVENT_HEADER_BYTES - this.headerOffset,
          bytes.byteLength - offset
        );
        this.header.set(bytes.subarray(offset, offset + count), this.headerOffset);
        this.headerOffset += count;
        offset += count;
        if (this.headerOffset < TERMINAL_EVENT_HEADER_BYTES) continue;

        const payloadBytes = new DataView(this.header.buffer).getUint32(1, true);
        if (payloadBytes > MAX_TERMINAL_EVENT_PAYLOAD_BYTES) {
          this.reset();
          throw new Error(`Terminal semantic event exceeds ${MAX_TERMINAL_EVENT_PAYLOAD_BYTES} bytes`);
        }
        this.eventType = this.header[0];
        this.payload = new Uint8Array(payloadBytes);
        this.payloadOffset = 0;
        if (payloadBytes === 0) {
          const event = decodeTerminalEvent(this.eventType, this.payload);
          if (event) target.push(event);
          this.reset();
        }
        continue;
      }

      const count = Math.min(
        this.payload.byteLength - this.payloadOffset,
        bytes.byteLength - offset
      );
      this.payload.set(bytes.subarray(offset, offset + count), this.payloadOffset);
      this.payloadOffset += count;
      offset += count;
      if (this.payloadOffset === this.payload.byteLength) {
        const event = decodeTerminalEvent(this.eventType, this.payload);
        if (event) target.push(event);
        this.reset();
      }
    }
  }

  private reset(): void {
    this.headerOffset = 0;
    this.eventType = 0;
    this.payload = new Uint8Array(0);
    this.payloadOffset = 0;
  }
}

function decodeTerminalEvent(
  type: number,
  payload: Uint8Array
): GhosttyTerminalEvent | null {
  switch (type) {
    case 1:
      return { type: 'bell' };
    case 2:
      return { type: 'title', title: decodeEventText(payload) };
    case 3:
      return { type: 'pwd', uri: decodeEventText(payload) };
    case 4:
      if (payload.byteLength < 1) return null;
      return {
        type: 'clipboard',
        selection: String.fromCharCode(payload[0]),
        data: decodeEventText(payload.subarray(1)),
      };
    case 5: {
      if (payload.byteLength < 4) return null;
      const titleLength = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      ).getUint32(0, true);
      if (titleLength > payload.byteLength - 4) return null;
      return {
        type: 'notification',
        title: decodeEventText(payload.subarray(4, 4 + titleLength)),
        body: decodeEventText(payload.subarray(4 + titleLength)),
      };
    }
    case 6:
      return { type: 'prompt-start' };
    case 7:
      return { type: 'prompt-continuation' };
    case 8:
      return { type: 'prompt-end' };
    case 9:
      return { type: 'end-of-input' };
    case 10:
      return {
        type: 'end-of-command',
        exitCode: payload[0] === undefined || payload[0] === 255 ? null : payload[0],
      };
    default:
      return null;
  }
}

function decodeEventText(bytes: Uint8Array): string {
  return terminalTextDecoder.decode(bytes);
}

function nextPowerOfTwo(value: number): number {
  let result = 256;
  while (result < value) result *= 2;
  return result;
}

function encodeCursorStyle(style: 'block' | 'underline' | 'bar'): number {
  if (style === 'underline') return 1;
  if (style === 'bar') return 2;
  return 0;
}

function decodeCursorStyle(value: number): 'block' | 'underline' | 'bar' {
  if (value === 1) return 'underline';
  if (value === 2) return 'bar';
  return 'block';
}
