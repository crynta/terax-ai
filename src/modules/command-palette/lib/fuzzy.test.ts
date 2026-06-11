import { describe, expect, it } from "vitest";
import { fuzzyBest, fuzzyScore } from "./fuzzy";

function score(query: string, target: string): number {
  const s = fuzzyScore(query, target);
  expect(s).not.toBeNull();
  return s ?? Number.NaN;
}

describe("fuzzyScore", () => {
  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("returns null when not a subsequence", () => {
    expect(fuzzyScore("xyz", "split pane")).toBeNull();
    expect(fuzzyScore("longer", "abc")).toBeNull();
  });

  it("matches non-contiguous subsequences", () => {
    expect(fuzzyScore("splr", "split pane right")).not.toBeNull();
  });

  it("scores word-boundary matches above mid-word matches", () => {
    expect(score("np", "new private")).toBeGreaterThan(score("np", "unzip"));
  });

  it("rewards consecutive runs over scattered matches", () => {
    expect(score("set", "settings")).toBeGreaterThan(
      score("set", "split editor tab"),
    );
  });
});

describe("fuzzyBest", () => {
  it("takes the highest-scoring candidate", () => {
    const score = fuzzyBest("ai", ["close tab", "toggle ai agent"]);
    expect(score).not.toBeNull();
  });

  it("returns null when no candidate matches", () => {
    expect(fuzzyBest("zzz", ["one", "two"])).toBeNull();
  });
});
