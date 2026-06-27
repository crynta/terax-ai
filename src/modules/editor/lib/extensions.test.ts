import { describe, expect, it } from "vitest";
import { buildMinimapExt, minimapCompartment } from "./extensions";
import { Compartment } from "@codemirror/state";

describe("buildMinimapExt", () => {
  it("returns empty array when disabled", () => {
    expect(buildMinimapExt(false)).toEqual([]);
  });

  it("returns a non-empty extension when enabled", () => {
    const ext = buildMinimapExt(true);
    expect(ext).not.toEqual([]);
    expect(ext).toBeTruthy();
  });
});

describe("minimapCompartment", () => {
  it("is a Compartment instance", () => {
    expect(minimapCompartment).toBeInstanceOf(Compartment);
  });
});
