import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
  subscribeTerminalResizeInteraction,
} from "./terminalResizeInteraction";

afterEach(() => vi.useRealTimers());

describe("terminalResizeInteraction", () => {
  it("publishes one transaction across repeated layout updates", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalResizeInteraction(listener);
    const token = {};

    beginTerminalResizeInteraction(token);
    beginTerminalResizeInteraction(token);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(true);

    endTerminalResizeInteraction(token);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });

  it("stays active until nested layout transactions have completed", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalResizeInteraction(listener);
    const outer = {};
    const inner = {};

    beginTerminalResizeInteraction(outer);
    beginTerminalResizeInteraction(inner);
    endTerminalResizeInteraction(outer);
    expect(listener).toHaveBeenCalledTimes(1);

    endTerminalResizeInteraction(inner);
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });
});
