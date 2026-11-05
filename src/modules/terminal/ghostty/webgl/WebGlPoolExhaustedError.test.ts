import { expect, it } from "vitest";
import { WebGlPoolExhaustedError } from "./WebGlPoolExhaustedError";

it("tells the user what to do, not how the pool is built", () => {
  const error = new WebGlPoolExhaustedError(12);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("WebGlPoolExhaustedError");
  expect(error.limit).toBe(12);
  expect(error.message).toBe(
    "Too many visible WebGL terminals (12). Close a pane or switch the renderer to WebGPU in Settings.",
  );
  expect(error.message).not.toMatch(/pool|slot|exhausted/i);
});
