import { describe, expect, it, vi } from "vitest";
import { replaceSessionSurface } from "@/modules/terminal/ghostty/replaceSessionSurface";
import { GhosttySearchController } from "@/modules/terminal/ghostty/search/GhosttySearchController";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";

function surface() {
  const search = {
    snapshot: vi.fn(() => ({ query: "agent", pendingDirection: null })),
    restore: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
  };
  return { dispose: vi.fn(), searchController: () => search };
}

describe("renderer replacement ownership", () => {
  it("transfers pending search navigation once when native scrolling notifies both surfaces", () => {
    let complete = false;
    const damage = new Set<() => void>();
    const status = () => ({
      active: true,
      pending: !complete,
      complete,
      generation: 1,
      totalMatches: 2,
      selectedIndex: -1,
    });
    const model = {
      cols: 2,
      rows: 1,
      setSearchQuery: vi.fn(status),
      stepSearch: vi.fn(status),
      selectSearchMatch: vi.fn(() => {
        for (const notify of damage) notify();
        return { ...status(), selectedIndex: 0 };
      }),
      searchViewportMatches: () => [],
    } as unknown as GhosttyTerminalModelApi;
    const create = () => {
      const controller = new GhosttySearchController(model, vi.fn(), {
        request: () => 1,
        cancel: vi.fn(),
      });
      const notify = () => controller.refresh();
      damage.add(notify);
      return {
        searchController: () => controller,
        dispose: () => {
          damage.delete(notify);
          controller.dispose();
        },
      };
    };
    const previous = create();
    previous.searchController().findNext("agent");
    complete = true;
    const state = { surface: previous, input: { dispose: vi.fn() } };
    replaceSessionSurface(state, create, vi.fn(), () => ({ dispose: vi.fn() }));
    expect(model.selectSearchMatch).toHaveBeenCalledOnce();
    expect(model.setSearchQuery).toHaveBeenCalledOnce();
    expect(damage.size).toBe(1);
    state.surface.dispose();
  });

  it("commits presentation only after attachment and retains the PTY and model", () => {
    const previous = surface();
    const previousInput = { dispose: vi.fn() };
    const replacement = surface();
    const input = { dispose: vi.fn() };
    const model = { dispose: vi.fn() };
    const pty = { close: vi.fn() };
    const state = { surface: previous, input: previousInput, model, pty };
    replaceSessionSurface(
      state,
      () => replacement,
      () => {
        expect(state.surface).toBe(previous);
        expect(previous.dispose).not.toHaveBeenCalled();
      },
      () => input,
    );
    expect(state.surface).toBe(replacement);
    expect(state.input).toBe(input);
    expect(replacement.searchController().restore).toHaveBeenCalledWith({
      query: "agent",
      pendingDirection: null,
    });
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(previousInput.dispose).toHaveBeenCalledOnce();
    expect(model.dispose).not.toHaveBeenCalled();
    expect(pty.close).not.toHaveBeenCalled();
  });

  it.each(["input", "attach", "search"])(
    "rolls back a failed %s stage and releases partial resources",
    (failure) => {
      const previous = surface();
      const previousInput = { dispose: vi.fn() };
      const replacement = surface();
      const input = { dispose: vi.fn() };
      const state = { surface: previous, input: previousInput };
      if (failure === "search")
        replacement.searchController().restore.mockImplementation(() => {
          throw new Error("search");
        });
      expect(() =>
        replaceSessionSurface(
          state,
          () => replacement,
          () => {
            if (failure === "attach") throw new Error("attach");
          },
          () => {
            if (failure === "input") throw new Error("input");
            return input;
          },
        ),
      ).toThrow(failure);
      expect(state.surface).toBe(previous);
      expect(state.input).toBe(previousInput);
      expect(previous.dispose).not.toHaveBeenCalled();
      expect(previousInput.dispose).not.toHaveBeenCalled();
      expect(previous.searchController().resume).toHaveBeenCalledOnce();
      expect(replacement.dispose).toHaveBeenCalledOnce();
      expect(input.dispose).toHaveBeenCalledTimes(failure === "input" ? 0 : 1);
    },
  );
});
