import { expect, it } from "vitest";
import { WebGlPoolExhaustedError } from "./WebGlPoolExhaustedError";

it("tells the user what to do, not how the pool is built", () => {
  const error = new WebGlPoolExhaustedError(12);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("WebGlPoolExhaustedError");
  expect(error.limit).toBe(12);
  expect(error.message).toBe(
    "Too many visible WebGL terminals (12). Close a pane and retry, or choose WebGPU in Settings for new terminals.",
  );
  expect(error.message).not.toMatch(/pool|slot|exhausted/i);
  // Retry recreates a WebGL surface and a pane keeps the renderer it opened with, so the
  // renderer choice is promised only for new terminals.
  expect(error.message).toContain("retry");
  expect(error.message).toContain("for new terminals");
});
