import { describe, expect, it } from "vitest";
import {
  BACKGROUND_TERMINAL_FRAME_INTERVAL_MS,
  FOCUSED_TERMINAL_FRAME_INTERVAL_MS,
  terminalFrameIntervalMs,
  UNFOCUSED_WINDOW_FRAME_INTERVAL_MS,
} from "./renderScheduling";

describe("terminalFrameIntervalMs", () => {
  it("paces focused terminal work at no more than 60 frames per second", () => {
    expect(terminalFrameIntervalMs(true, true)).toBe(
      FOCUSED_TERMINAL_FRAME_INTERVAL_MS,
    );
  });

  it("reduces visible background panes to 30 frames per second", () => {
    expect(terminalFrameIntervalMs(true, false)).toBe(
      BACKGROUND_TERMINAL_FRAME_INTERVAL_MS,
    );
  });

  it("reduces the entire renderer while its window is unfocused", () => {
    expect(terminalFrameIntervalMs(false, true)).toBe(
      UNFOCUSED_WINDOW_FRAME_INTERVAL_MS,
    );
  });
});
