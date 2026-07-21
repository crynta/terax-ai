import { describe, expect, it } from "vitest";
import { pendingPtyResize } from "./rendererResize";

describe("pendingPtyResize", () => {
  it("returns null when the grid already matches the committed PTY size", () => {
    expect(
      pendingPtyResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 }),
    ).toBeNull();
  });

  it("reports the grid size when columns advanced past the PTY", () => {
    expect(
      pendingPtyResize({ cols: 100, rows: 24 }, { cols: 80, rows: 24 }),
    ).toEqual({ cols: 100, rows: 24 });
  });

  it("reports the grid size when rows advanced past the PTY", () => {
    expect(
      pendingPtyResize({ cols: 80, rows: 30 }, { cols: 80, rows: 24 }),
    ).toEqual({ cols: 80, rows: 30 });
  });

  it("reports a shrink as readily as a grow", () => {
    expect(
      pendingPtyResize({ cols: 60, rows: 20 }, { cols: 80, rows: 24 }),
    ).toEqual({ cols: 60, rows: 20 });
  });

  it("never emits a degenerate (zero/negative) resize during teardown", () => {
    expect(
      pendingPtyResize({ cols: 0, rows: 24 }, { cols: 80, rows: 24 }),
    ).toBeNull();
    expect(
      pendingPtyResize({ cols: 80, rows: 0 }, { cols: 80, rows: 24 }),
    ).toBeNull();
    expect(
      pendingPtyResize({ cols: -1, rows: 24 }, { cols: 80, rows: 24 }),
    ).toBeNull();
  });

  // Regression: tmux pane-bleed. A container resize fits the grid to 100x30 but
  // the leaf is released before the debounced PTY-resize timer fires. The
  // pending delta must be surfaced so the caller can commit it; a dropped
  // resize leaves the PTY winsize behind the grid and tmux smears pane content
  // across the dividers.
  it("surfaces a pending resize an interrupted debounce would have dropped", () => {
    const grid = { cols: 100, rows: 30 };
    const lastCommittedToPty = { cols: 80, rows: 24 };
    expect(pendingPtyResize(grid, lastCommittedToPty)).toEqual({
      cols: 100,
      rows: 30,
    });
  });
});
