export type ResizeGestureIo = {
  /** Starts a terminal resize gesture (shells resize once, at its end). */
  begin: () => void;
  end: () => void;
  apply: (ratios: readonly number[]) => void;
  schedule: (flush: () => void) => number;
  cancel: (handle: number) => void;
};

/**
 * One divider gesture (a drag or held arrow keys): the terminal gesture spans
 * it exactly once, and ratio writes are coalesced to one per frame, with the
 * last value applied when it ends.
 */
export function createResizeGesture(io: ResizeGestureIo) {
  let active = false;
  let frame: number | null = null;
  let pending: readonly number[] | null = null;

  const flush = () => {
    frame = null;
    if (pending) io.apply(pending);
    pending = null;
  };

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      active = true;
      io.begin();
    },
    update(ratios: readonly number[]) {
      pending = ratios;
      frame ??= io.schedule(flush);
    },
    finish() {
      if (frame !== null) io.cancel(frame);
      flush();
      if (!active) return;
      active = false;
      io.end();
    },
  };
}
