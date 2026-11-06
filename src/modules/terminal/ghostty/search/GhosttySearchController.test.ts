import { describe, expect, it, vi } from "vitest";
import type {
  GhosttySearchStatus,
  GhosttyTerminalModelApi,
} from "../GhosttyTerminalModel";
import { GhosttySearchController } from "./GhosttySearchController";

const status: GhosttySearchStatus = {
  active: true,
  pending: false,
  complete: true,
  generation: 1,
  totalMatches: 0,
  selectedIndex: -1,
};

function model(overrides: Record<string, unknown> = {}) {
  return {
    cols: 4,
    rows: 1,
    setSearchQuery: vi.fn(() => status),
    stepSearch: vi.fn(() => status),
    selectSearchMatch: vi.fn(() => status),
    clearSearch: vi.fn(),
    searchViewportMatches: () => [],
    ...overrides,
  } as unknown as GhosttyTerminalModelApi & {
    setSearchQuery: ReturnType<typeof vi.fn>;
    clearSearch: ReturnType<typeof vi.fn>;
  };
}

describe("GhosttySearchController (loads its engine on first use)", () => {
  it("does nothing, and loads nothing, until a search is asked for", () => {
    const stub = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(stub, onChange);
    search.refreshOverlay();
    search.invalidate();
    search.suspend();
    search.resume();
    expect(search.snapshot()).toEqual({ query: "", pendingDirection: null });
    expect(search.maskRevision).toBe(0);
    expect(search.viewportMaskBytes()).toBeNull();
    expect(search.matchAt(0, 0)).toBe(0);
    expect(stub.setSearchQuery).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("runs the first find once the engine has loaded", async () => {
    const stub = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(stub, onChange);
    expect(search.findNext("agent")).toBe(false);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(stub.setSearchQuery).toHaveBeenCalledWith("agent");
    expect(search.snapshot().query).toBe("agent");
    // Afterwards it answers directly.
    search.findPrevious("agent");
    expect(stub.setSearchQuery).toHaveBeenCalledOnce();
    search.dispose();
  });

  it("replays only the latest request made while loading", async () => {
    const stub = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(stub, onChange);
    search.findNext("first");
    search.findPrevious("second");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(stub.setSearchQuery).toHaveBeenCalledOnce();
    expect(stub.setSearchQuery).toHaveBeenCalledWith("second");
    search.dispose();
  });

  it("ignores finds while suspended or empty", async () => {
    const stub = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(stub, onChange);
    search.findNext("");
    search.suspend();
    search.findNext("agent");
    search.resume();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stub.setSearchQuery).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("starts suspended when suspended while loading, and never loads once disposed", async () => {
    const stub = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(stub, onChange);
    search.findNext("agent");
    search.suspend();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    // The engine took the suspension: further finds are refused until resume.
    expect(search.findNext("other")).toBe(false);
    expect(stub.setSearchQuery).toHaveBeenCalledOnce();
    search.dispose();

    const late = new GhosttySearchController(model(), vi.fn());
    late.findNext("agent");
    late.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(late.snapshot().query).toBe("");
  });

  it("clears the model's search without loading the engine", () => {
    const stub = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(stub, onChange);
    search.clearDecorations();
    expect(stub.clearSearch).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("drops a queued find when decorations are cleared", async () => {
    const stub = model();
    const search = new GhosttySearchController(stub, vi.fn());
    search.findNext("agent");
    search.clearDecorations();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stub.setSearchQuery).not.toHaveBeenCalled();
  });

  it("restores a query on the engine and highlights block matches", async () => {
    const restored = model();
    const onChange = vi.fn();
    const search = new GhosttySearchController(restored, onChange);
    search.restore({ query: "", pendingDirection: null });
    search.restore({ query: "agent", pendingDirection: null });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(search.snapshot().query).toBe("agent");
    search.dispose();

    const blocks = model({
      blockSearchActive: () => true,
      searchViewportMatches: () => [
        { row: 0, startColumn: 1, endColumn: 3, selected: false },
      ],
    });
    const overlay = new GhosttySearchController(blocks, vi.fn());
    overlay.refreshOverlay();
    await vi.waitFor(() => expect(overlay.maskRevision).toBeGreaterThan(0));
    expect(overlay.matchAt(0, 1)).toBe(1);
    expect(blocks.setSearchQuery).not.toHaveBeenCalled();
    overlay.dispose();
  });
});
