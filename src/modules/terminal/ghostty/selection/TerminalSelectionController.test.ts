import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { AdaptedGhosttyTerminalModel } from "@/modules/terminal/ghostty/AdaptedGhosttyTerminalModel";
import { describe, expect, it, vi } from "vitest";
import type {
  GhosttyTerminalModelApi,
  TerminalBufferSelection,
} from "../GhosttyTerminalModel";
import {
  normalizeSelection,
  selectionContains,
  shouldStartTerminalSelection,
  TerminalSelectionController,
} from "./TerminalSelectionController";

describe("selection across renderer replacement", () => {
  it("adopts native selection immediately and reconciles pruning without clearing the model", () => {
    let tracked: TerminalBufferSelection | null = {
      anchor: { line: 4, column: 1 },
      focus: { line: 4, column: 5 },
      rectangular: false,
    };
    const model = {
      trackedSelection: () => tracked,
      selectionText: vi.fn(() => "hello"),
      setSelection: vi.fn(),
    } as unknown as GhosttyTerminalModelApi;
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    const create = () =>
      new TerminalSelectionController({
        model,
        target,
        cellSize: () => ({ width: 8, height: 16 }),
        shouldIgnoreTarget: () => false,
        onChange: vi.fn(),
      });
    const original = create();
    original.dispose();
    const replacement = create();
    expect(replacement.text()).toBe("hello");
    expect(replacement.contains(4, 3)).toBe(true);
    tracked = null;
    expect(replacement.reconcile()).toBe(true);
    expect(replacement.text()).toBeNull();
    tracked = {
      anchor: { line: 0, column: 0 },
      focus: { line: 0, column: 2 },
      rectangular: false,
    };
    expect(replacement.reconcile()).toBe(true);
    expect(replacement.value).toEqual(tracked);
    replacement.dispose();
    expect(model.setSelection).not.toHaveBeenCalled();
  });
});

describe("terminal selection pointer ownership", () => {
  it.each(["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"])(
    "uses native mouse click counts for word and line selection (%s)",
    async (artifact) => {
      const bytes = await readFile(
        new URL(
          `../../../../../packages/ghostty-core/adapted/${artifact}`,
          import.meta.url,
        ),
      );
      const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
      const model = new AdaptedGhosttyTerminalModel(core, {
        backend: "ghostty-webgpu",
        cols: 80,
        rows: 24,
      });
      const h = dragFixture(model);
      try {
        model.write(
          new TextEncoder().encode("alpha bravo charlie\r\ne\u0301clair_42"),
        );
        h.pointer("pointerdown", 65);
        const down = Object.assign(
          new Event("mousedown", { cancelable: true }),
          { button: 0, detail: 2, clientX: 65, clientY: 10, altKey: false },
        );
        h.target.dispatchEvent(down);
        h.pointer("pointerup", 65);
        expect(down.defaultPrevented).toBe(true);
        expect(h.controller.text()).toBe("bravo");
        h.pointer("pointerdown", 65);
        h.target.dispatchEvent(
          Object.assign(new Event("mousedown", { cancelable: true }), {
            button: 0,
            detail: 2,
            clientX: 65,
            clientY: 10,
            altKey: false,
          }),
        );
        h.pointer("pointermove", 155);
        h.pointer("pointerup", 155);
        expect(h.controller.text()).toBe("bravo charlie");
        h.pointer("pointerdown", 65);
        h.target.dispatchEvent(
          Object.assign(new Event("mousedown", { cancelable: true }), {
            button: 0,
            detail: 3,
            clientX: 65,
            clientY: 10,
            altKey: false,
          }),
        );
        h.pointer("pointerup", 65);
        expect(h.controller.text()).toBe("alpha bravo charlie");
        h.pointer("pointerdown", 5, 30);
        h.target.dispatchEvent(
          Object.assign(new Event("mousedown", { cancelable: true }), {
            button: 0,
            detail: 2,
            clientX: 5,
            clientY: 30,
            altKey: false,
          }),
        );
        h.pointer("pointerup", 5, 30);
        expect(h.controller.text()).toBe("e\u0301clair_42");
      } finally {
        h.controller.dispose();
        model.dispose();
      }
    },
  );

  it("ignores mouse jitter across a cell boundary", () => {
    const h = dragFixture();
    h.pointer("pointerdown", 19);
    h.pointer("pointermove", 21);
    h.pointer("pointerup", 21);
    expect(h.controller.value).toBeNull();
    expect(h.tracked()).toBeNull();
    h.controller.dispose();
  });

  it("extends a completed selection with Shift without moving its anchor", () => {
    const h = dragFixture();
    h.pointer("pointerdown", 45);
    h.pointer("pointermove", 75);
    h.pointer("pointerup", 75);
    h.pointer("pointerdown", 15, 10, { shiftKey: true });
    h.pointer("pointerup", 15, 10, { shiftKey: true });
    expect(h.controller.value).toEqual({
      anchor: { line: 0, column: 4 },
      focus: { line: 0, column: 1 },
      rectangular: false,
    });
    h.controller.dispose();
  });

  it("copies the current native selection without waiting for a render frame", () => {
    const h = dragFixture();
    h.pointer("pointerdown", 15);
    h.pointer("pointermove", 45);
    h.pointer("pointerup", 45);
    h.model.setSelection?.(null);
    expect(h.controller.text()).toBeNull();
    h.controller.dispose();
  });

  it("stops a drag when the mouse button was released outside the window", () => {
    const h = dragFixture();
    h.pointer("pointerdown", 15);
    h.pointer("pointermove", 45);
    h.pointer("pointermove", 75, 10, { buttons: 0 });
    expect(h.target.hasPointerCapture(1)).toBe(false);
    expect(h.controller.value?.focus.column).toBe(4);
    h.pointer("pointermove", 95);
    expect(h.controller.value?.focus.column).toBe(4);
    h.controller.dispose();
  });

  it("clamps an outside drag to visible rows in a shorter pane", () => {
    const h = dragFixture();
    h.target.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 60,
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      h.pointer("pointerdown", 15);
      h.pointer("pointermove", 45, 200);
      h.pointer("pointerup", 45, 200);
      expect(h.controller.value?.focus.line).toBe(2);
    } finally {
      h.controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("autoscrolls at the same speed on 60 Hz and 144 Hz displays", () => {
    const run = (hz: number) => {
      let frame: FrameRequestCallback | undefined;
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          frame = callback;
          return 1;
        },
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const h = dragFixture();
      vi.mocked(h.model.scrollBy).mockReturnValue(true);
      try {
        h.pointer("pointerdown", 15);
        h.pointer("pointermove", 45, -20);
        for (let index = 0; index <= hz; index++) {
          const tick = frame;
          frame = undefined;
          tick?.((index * 1_000) / hz);
        }
        return vi
          .mocked(h.model.scrollBy)
          .mock.calls.reduce((sum, [lines]) => sum + Math.abs(lines), 0);
      } finally {
        h.controller.dispose();
        vi.unstubAllGlobals();
      }
    };
    const slow = run(60);
    const fast = run(144);
    expect(slow).toBeGreaterThanOrEqual(30);
    expect(slow).toBeLessThanOrEqual(31);
    expect(Math.abs(slow - fast)).toBeLessThanOrEqual(1);
  });

  it("updates only selected rows without rebuilding native text or accumulating duplicate uploads", async () => {
    const bytes = await readFile(
      new URL(
        "../../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
        import.meta.url,
      ),
    );
    const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    const model = new AdaptedGhosttyTerminalModel(core, {
      backend: "ghostty-webgpu",
      cols: 120,
      rows: 40,
    });
    try {
      model.write(new TextEncoder().encode("hello terminal"));
      model.consumeDamage();
      const revision = model.revision();
      const updates = model.diagnostics().renderStateUpdates;
      for (let column = 1; column < 12; column++)
        model.setSelection({
          anchor: { line: 0, column: 0 },
          focus: { line: 0, column },
          rectangular: false,
        });
      expect(model.consumeDamage()).toEqual({
        kind: "rows",
        ranges: [{ start: 0, end: 0 }],
      });
      expect(model.diagnostics().renderStateUpdates).toBe(updates);
      expect(model.revision()).toBe(revision);
      const selection = model.trackedSelection();
      if (!selection) throw new Error("Expected the tracked selection");
      expect(model.selectionText(selection)).toBe("hello termin");
      model.setSelection(null);
      expect(model.consumeDamage()).toEqual({
        kind: "rows",
        ranges: [{ start: 0, end: 0 }],
      });
      model.write(new TextEncoder().encode(" next"));
      expect(model.consumeDamage().kind).not.toBe("none");
      expect(model.renderCells().codepoint(0)).toBe(104);
    } finally {
      model.dispose();
    }
  });

  it("drags in both directions across real Ghostty render synchronization", async () => {
    const bytes = await readFile(
      new URL(
        "../../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
        import.meta.url,
      ),
    );
    const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    const model = new AdaptedGhosttyTerminalModel(core, {
      backend: "ghostty-webgpu",
      cols: 80,
      rows: 24,
    });
    const fixture = dragFixture(model);
    try {
      model.write(new TextEncoder().encode("hello terminal"));
      fixture.pointer("pointerdown", 5);
      fixture.controller.reconcile();
      model.write(new TextEncoder().encode(" output"));
      fixture.controller.reconcile();
      fixture.pointer("pointermove", 45);
      fixture.controller.reconcile();
      fixture.pointer("pointerup", 45);
      expect(fixture.controller.text()).toBe("hello");
      fixture.pointer("pointerdown", 45);
      fixture.controller.reconcile();
      fixture.pointer("pointermove", 5);
      fixture.controller.reconcile();
      fixture.pointer("pointerup", 5);
      expect(fixture.controller.text()).toBe("hello");
      fixture.pointer("pointerdown", 5);
      fixture.controller.reconcile();
      fixture.pointer("pointerup", 45);
      expect(fixture.controller.text()).toBe("hello");
    } finally {
      fixture.controller.dispose();
      model.dispose();
    }
  });

  it("selects the text drawn under the pointer while the grid is shifted up, across real Ghostty rows", async () => {
    const bytes = await readFile(
      new URL(
        "../../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
        import.meta.url,
      ),
    );
    const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    const model = new AdaptedGhosttyTerminalModel(core, {
      backend: "ghostty-webgpu",
      cols: 80,
      rows: 24,
    });
    // One row (20 px) of the grid is moved off the top of a shorter pane.
    const fixture = dragFixture(model, () => 20);
    try {
      model.write(new TextEncoder().encode("alpha\r\nbravo\r\ncharlie"));
      fixture.pointer("pointerdown", 5, 10);
      fixture.controller.reconcile();
      fixture.pointer("pointermove", 45, 10);
      fixture.controller.reconcile();
      fixture.pointer("pointerup", 45, 10);
      expect(fixture.controller.text()).toBe("bravo");
    } finally {
      fixture.controller.dispose();
      model.dispose();
    }
  });

  it("retains a single-click drag anchor through render frames without selecting a click", () => {
    const fixture = dragFixture();
    fixture.pointer("pointerdown", 15);
    fixture.controller.reconcile();
    expect(fixture.controller.value).toBeNull();
    expect(fixture.tracked()?.anchor.column).toBe(1);
    fixture.pointer("pointermove", 16);
    expect(fixture.controller.value).toBeNull();
    fixture.pointer("pointermove", 45);
    fixture.controller.reconcile();
    fixture.pointer("pointerup", 45);
    expect(fixture.controller.value).toEqual({
      anchor: { line: 0, column: 1 },
      focus: { line: 0, column: 4 },
      rectangular: false,
    });
    const changes = fixture.onChange.mock.calls.length;
    fixture.pointer("pointermove", 75);
    expect(fixture.onChange).toHaveBeenCalledTimes(changes);
    fixture.pointer("pointerdown", 25);
    fixture.controller.reconcile();
    fixture.pointer("pointerup", 25);
    expect(fixture.tracked()).toBeNull();
    fixture.controller.dispose();
  });

  it("keeps the pending anchor pinned across reflow and discards it on lost capture", () => {
    const fixture = dragFixture();
    fixture.pointer("pointerdown", 15);
    fixture.model.setSelection?.({
      anchor: { line: 1, column: 2 },
      focus: { line: 1, column: 2 },
      rectangular: false,
    });
    fixture.controller.reconcile();
    expect(fixture.controller.value).toBeNull();
    fixture.pointer("pointermove", 45);
    expect(fixture.controller.value?.anchor).toEqual({ line: 1, column: 2 });
    fixture.pointer("pointerup", 45);
    fixture.pointer("pointerdown", 15);
    fixture.pointer("lostpointercapture", 15);
    expect(fixture.tracked()).toBeNull();
    fixture.pointer("pointermove", 45);
    expect(fixture.controller.value).toBeNull();
    fixture.controller.dispose();
  });

  it("stops autoscrolling when the history boundary is reached", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const fixture = dragFixture();
    try {
      fixture.pointer("pointerdown", 15);
      fixture.pointer("pointermove", 45, -20);
      const tick = frame;
      frame = undefined;
      tick?.(16);
      expect(fixture.model.scrollBy).toHaveBeenCalledOnce();
      expect(frame).toBeUndefined();
    } finally {
      fixture.controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("selects the cell that is drawn under the pointer while the grid is shifted up", () => {
    // A pane shorter than its grid during a resize gesture shows the grid moved up by 40 px.
    let shift = 40;
    const fixture = dragFixture(undefined, () => shift);
    fixture.pointer("pointerdown", 15, 10);
    fixture.pointer("pointermove", 45, 50);
    fixture.pointer("pointerup", 45, 50);
    // 10 + 40 is in row 2, 50 + 40 in row 4 (rows are 20 px).
    expect(fixture.controller.value).toEqual({
      anchor: { line: 2, column: 1 },
      focus: { line: 4, column: 4 },
      rectangular: false,
    });
    fixture.pointer("pointerdown", 15, 10);
    fixture.pointer("pointerup", 15, 10);
    shift = 0;
    fixture.pointer("pointerdown", 15, 10);
    fixture.pointer("pointermove", 45, 50);
    fixture.pointer("pointerup", 45, 50);
    expect(fixture.controller.value?.anchor.line).toBe(0);
    expect(fixture.controller.value?.focus.line).toBe(2);
    fixture.controller.dispose();
  });

  it("does not capture a pointer already claimed by a resize separator", () => {
    expect(
      shouldStartTerminalSelection(
        {
          button: 0,
          defaultPrevented: true,
          shiftKey: false,
          target: null,
        },
        () => false,
        false,
      ),
    ).toBe(false);
  });

  it("keeps Shift selection available when an application tracks the mouse", () => {
    expect(
      shouldStartTerminalSelection(
        {
          button: 0,
          defaultPrevented: false,
          shiftKey: true,
          target: null,
        },
        () => false,
        true,
      ),
    ).toBe(true);
  });
});

function dragFixture(
  realModel?: GhosttyTerminalModelApi,
  gridShiftY?: () => number,
) {
  let tracked: TerminalBufferSelection | null = null;
  let capture: number | null = null;
  const target = Object.assign(new EventTarget(), {
    setPointerCapture: (id: number) => {
      capture = id;
    },
    hasPointerCapture: (id: number) => capture === id,
    releasePointerCapture: () => {
      capture = null;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 480 }),
  });
  const model =
    realModel ??
    ({
      cols: 80,
      rows: 24,
      modes: () => ({ mouseTracking: false }),
      trackedSelection: () => tracked,
      setSelection: (value: TerminalBufferSelection | null) => {
        tracked = value;
      },
      bufferLineAtViewportRow: (row: number) => row,
      scrollBy: vi.fn(() => false),
    } as unknown as GhosttyTerminalModelApi);
  const onChange = vi.fn();
  const controller = new TerminalSelectionController({
    model,
    target: target as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    gridShiftY,
    shouldIgnoreTarget: () => false,
    onChange,
  });
  return {
    controller,
    model,
    onChange,
    tracked: () => tracked,
    target,
    pointer: (
      type: string,
      clientX: number,
      clientY = 10,
      values: Partial<PointerEvent> = {},
    ) =>
      target.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), {
          pointerId: 1,
          button: 0,
          detail: 0,
          pointerType: "mouse",
          buttons: type === "pointerup" ? 0 : 1,
          shiftKey: false,
          altKey: false,
          clientX,
          clientY,
          ...values,
        }),
      ),
  };
}

describe("terminal selection geometry", () => {
  it("normalizes backward selections", () => {
    expect(
      normalizeSelection({
        anchor: { line: 8, column: 2 },
        focus: { line: 3, column: 7 },
        rectangular: false,
      }),
    ).toEqual({
      start: { line: 3, column: 7 },
      end: { line: 8, column: 2 },
      left: 2,
      right: 7,
    });
  });

  it("matches linear selections across row boundaries", () => {
    const selection: TerminalBufferSelection = {
      anchor: { line: 3, column: 7 },
      focus: { line: 5, column: 2 },
      rectangular: false,
    };
    expect(selectionContains(selection, { line: 3, column: 6 })).toBe(false);
    expect(selectionContains(selection, { line: 3, column: 7 })).toBe(true);
    expect(selectionContains(selection, { line: 4, column: 0 })).toBe(true);
    expect(selectionContains(selection, { line: 5, column: 2 })).toBe(true);
    expect(selectionContains(selection, { line: 5, column: 3 })).toBe(false);
  });

  it("matches rectangular selections in either drag direction", () => {
    const selection: TerminalBufferSelection = {
      anchor: { line: 5, column: 8 },
      focus: { line: 2, column: 3 },
      rectangular: true,
    };
    expect(selectionContains(selection, { line: 2, column: 3 })).toBe(true);
    expect(selectionContains(selection, { line: 4, column: 6 })).toBe(true);
    expect(selectionContains(selection, { line: 5, column: 9 })).toBe(false);
    expect(selectionContains(selection, { line: 1, column: 6 })).toBe(false);
  });
});
