import { describe, expect, it, vi } from "vitest";
import { repaintTerminalSlot } from "./webglRepaint";

describe("repaintTerminalSlot", () => {
  it("clears the WebGL texture atlas before refreshing", () => {
    const clearTextureAtlas = vi.fn();
    const refresh = vi.fn();
    repaintTerminalSlot({
      webglAddon: { clearTextureAtlas },
      term: { rows: 24, refresh },
    });
    expect(clearTextureAtlas).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(0, 23);
    expect(clearTextureAtlas.mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0]!,
    );
  });

  it("still refreshes when WebGL is not attached", () => {
    const refresh = vi.fn();
    repaintTerminalSlot({
      webglAddon: null,
      term: { rows: 10, refresh },
    });
    expect(refresh).toHaveBeenCalledWith(0, 9);
  });

  it("tolerates clearTextureAtlas throwing during dispose", () => {
    const refresh = vi.fn();
    expect(() =>
      repaintTerminalSlot({
        webglAddon: {
          clearTextureAtlas: () => {
            throw new Error("disposed");
          },
        },
        term: { rows: 5, refresh },
      }),
    ).not.toThrow();
    expect(refresh).toHaveBeenCalledWith(0, 4);
  });
});