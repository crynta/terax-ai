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

function dragFixture(realModel?: GhosttyTerminalModelApi) {
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
    shouldIgnoreTarget: () => false,
    onChange,
  });
  return {
    controller,
    model,
    onChange,
    tracked: () => tracked,
    pointer: (type: string, clientX: number, clientY = 10) =>
      target.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), {
          pointerId: 1,
          button: 0,
          detail: 1,
          shiftKey: false,
          altKey: false,
          clientX,
          clientY,
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
