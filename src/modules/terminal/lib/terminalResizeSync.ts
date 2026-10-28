/** The terminal grid a surface keeps in step with its host. */
type ResizeModel = {
  readonly cols: number;
  readonly rows: number;
  resize(cols: number, rows: number): void;
};

export type ResizeOutcome =
  /** The grid already has these dimensions. */
  | "unchanged"
  /** The model resized and the PTY was told, in the same call. */
  | "applied";

export type TerminalResizeSyncOptions = {
  readonly model: ResizeModel;
  /** Tells the PTY (SIGWINCH). Called right after the model resized, never separately. */
  readonly notify: (cols: number, rows: number) => void;
};

/**
 * Keeps the model's grid and the PTY's window size identical at all times.
 *
 * Ghostty clears the prompt when the model resizes and expects a shell that redraws on
 * SIGWINCH to put it back (OSC 133 `redraw`), and every program that repaints itself on
 * SIGWINCH (shells, Ink applications) repaints against the grid it was told about. Resizing
 * the model while the PTY heard about it later, or the PTY many times while the grid reflowed
 * once, leaves repaints that do not line up with the reflowed text: duplicated prompts and
 * agent boxes in scrollback. Both change in one synchronous call, model first, and the callers
 * make that call once per resize gesture, not once per pointer step: the surface keeps its
 * last grid while the host moves (the renderer clips or pads it) and applies the final size
 * when the gesture ends.
 */
export class TerminalResizeSync {
  constructor(private readonly options: TerminalResizeSyncOptions) {}

  /** Resizes the grid to `cols` x `rows` and tells the PTY, unless it already has that size. */
  request(cols: number, rows: number): ResizeOutcome {
    const { model } = this.options;
    if (cols === model.cols && rows === model.rows) return "unchanged";
    model.resize(cols, rows);
    this.options.notify(cols, rows);
    return "applied";
  }
}
