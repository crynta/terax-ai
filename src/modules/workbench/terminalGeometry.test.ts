import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import { describe, expect, it, vi } from "vitest";
import { requestTerminalRemeasure } from "./terminalGeometry";

vi.mock("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime", () => ({
  remeasureTerminalWindows: vi.fn(),
}));

describe("requestTerminalRemeasure", () => {
  it("re-reads pane rectangles at once outside a resize gesture", () => {
    const remeasure = vi.fn();
    requestTerminalRemeasure(remeasure);
    expect(remeasure).toHaveBeenCalledOnce();
  });

  it("waits for a gesture to end and then re-reads once", () => {
    const remeasure = vi.fn();
    const token = {};
    beginTerminalResizeInteraction(token);
    for (let i = 0; i < 10; i++) requestTerminalRemeasure(remeasure);
    expect(remeasure).not.toHaveBeenCalled();
    endTerminalResizeInteraction(token);
    expect(remeasure).toHaveBeenCalledOnce();
  });
});
