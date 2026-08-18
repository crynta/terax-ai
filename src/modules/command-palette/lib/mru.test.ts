import { describe, expect, it } from "vitest";
import { mruRank, mruSnapshot, recordUse } from "./mru";

describe("mruRank", () => {
  it("returns the recorded timestamp for a known id", () => {
    expect(mruRank({ a: 5, b: 9 }, "b")).toBe(9);
  });

  it("returns 0 for an id not in the snapshot", () => {
    expect(mruRank({ a: 5 }, "missing")).toBe(0);
  });

  it("returns 0 against an empty snapshot", () => {
    expect(mruRank({}, "anything")).toBe(0);
  });
});

describe("mru persistence without localStorage", () => {
  // The vitest node environment has no localStorage; the store must degrade
  // gracefully rather than throw.
  it("returns an empty snapshot when storage is unavailable", () => {
    expect(mruSnapshot()).toEqual({});
  });

  it("does not throw when recording a use", () => {
    expect(() => recordUse("some.command")).not.toThrow();
  });
});
