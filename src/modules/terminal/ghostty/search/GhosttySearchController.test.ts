import { describe, expect, it, vi } from "vitest";
import type {
  GhosttySearchStatus,
  GhosttyTerminalModelApi,
} from "../GhosttyTerminalModel";
import { GhosttySearchController } from "./GhosttySearchController";

const pendingStatus: GhosttySearchStatus = {
  active: true,
  pending: true,
  complete: false,
  generation: 1,
  totalMatches: 1,
  selectedIndex: -1,
};

const completeStatus: GhosttySearchStatus = {
  active: true,
  pending: false,
  complete: true,
  generation: 1,
  totalMatches: 2,
  selectedIndex: -1,
};

describe("GhosttySearchController", () => {
  it("steps incrementally and retains only viewport match cells", () => {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;
    let selected = false;
    const model = {
      cols: 5,
      rows: 2,
      setSearchQuery: vi.fn(() => pendingStatus),
      stepSearch: vi
        .fn<() => GhosttySearchStatus>()
        .mockReturnValueOnce(pendingStatus)
        .mockReturnValue(completeStatus),
      selectSearchMatch: vi.fn(() => {
        selected = true;
        return { ...completeStatus, selectedIndex: 0 };
      }),
      searchViewportMatches: vi.fn(() => [
        { row: 1, startColumn: 1, endColumn: 4, selected },
      ]),
      clearSearch: vi.fn(),
    } as unknown as GhosttyTerminalModelApi;
    const onChange = vi.fn();
    const controller = new GhosttySearchController(model, onChange, {
      request: (callback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel: (handle) => callbacks.delete(handle),
    });

    expect(controller.findNext("agent")).toBe(true);
    expect(model.stepSearch).toHaveBeenCalledWith(256);
    expect(controller.matchAt(1, 2)).toBe(1);
    expect(callbacks.size).toBe(1);

    const callback = callbacks.values().next().value;
    expect(callback).toBeTypeOf("function");
    callback?.();

    expect(model.selectSearchMatch).toHaveBeenCalledWith("next");
    expect(controller.matchAt(1, 2)).toBe(2);
    expect(controller.matchAt(0, 2)).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("cancels pending work and clears Ghostty search state", () => {
    const cancel = vi.fn();
    const model = {
      cols: 1,
      rows: 1,
      setSearchQuery: vi.fn(() => pendingStatus),
      stepSearch: vi.fn(() => pendingStatus),
      searchViewportMatches: vi.fn(() => []),
      clearSearch: vi.fn(),
    } as unknown as GhosttyTerminalModelApi;
    const controller = new GhosttySearchController(model, vi.fn(), {
      request: () => 42,
      cancel,
    });

    controller.findPrevious("x");
    controller.clearDecorations();

    expect(cancel).toHaveBeenCalledWith(42);
    expect(model.clearSearch).toHaveBeenCalledOnce();
  });
});
