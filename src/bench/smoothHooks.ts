/**
 * The seam between product code and the smoothness probe (`smoothProbe.ts`, bench builds only).
 * Callers write `if (__TERAX_BENCH__) smoothHooks()?.x(...)`: in a normal build the branch is the
 * literal `false` and this module is not part of the bundle.
 */
export const SMOOTH_KEY = "__teraxSmooth";

export type SmoothHooks = {
  /** A pane's host was measured: the grid it should have for that size. */
  want(pane: number, t: number, cols: number, rows: number): void;
  /** The pane's model grid after a fit ran; `costMs` is the model resize + PTY notify when applied. */
  have(
    pane: number,
    t: number,
    cols: number,
    rows: number,
    applied: boolean,
    costMs: number,
  ): void;
  /** The pane's rectangle in the window canvas changed (layout). */
  rect(pane: number, t: number): void;
  /** A layout change moved the pane by less than a device pixel: nothing to draw for it. */
  unchanged(pane: number): void;
  /** A window frame drew the pane. */
  drawn(pane: number, t: number): void;
  /** One animation-frame pass that submitted a window frame (`costMs`: time inside the pass). */
  frame(t: number, costMs: number): void;
  /** A prompt-redraw hold started (`true`) or ended on one pane's model. */
  hold(instance: number, start: boolean, t: number): void;
  /** A resize erased the prompt of a model (`true`) or the shell printed it again (`false`). */
  cleared(instance: number, erased: boolean, t: number): void;
  /** A pane presented a frame while its prompt was erased. */
  blank(pane: number, t: number): void;
  /** The window canvas reallocated its backing store (`costMs`: the commit itself). */
  realloc(
    t: number,
    costMs: number,
    width: number,
    height: number,
    gesture: boolean,
    area: string,
  ): void;
  /** A frame was prepared with the cursor visible; `onScreen` is false when the pane clips it. */
  cursor(pane: number, onScreen: boolean): void;
  /** A pane presented a frame of this grid (not a held one). */
  shown(pane: number, t: number, cols: number, rows: number): void;
};

/** The installed probe, or undefined (not a bench run, or not installed yet). */
export function smoothHooks(): SmoothHooks | undefined {
  // The literal `false` in a normal build: the key string and the lookup are not emitted even
  // when a call site forgot its own guard (src/app/dist-budget.test.ts locks `__teraxSmooth`).
  if (!__TERAX_BENCH__) return undefined;
  return (globalThis as unknown as Record<string, SmoothHooks | undefined>)[
    SMOOTH_KEY
  ];
}
