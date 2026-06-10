import { describe, expect, it } from "vitest";
import { nextSuggestionChunk } from "./suggestionChunk";

describe("nextSuggestionChunk", () => {
  it("returns empty for an empty remainder", () => {
    expect(nextSuggestionChunk("")).toBe("");
  });

  it("takes leading separators plus the next word", () => {
    expect(nextSuggestionChunk(" status --short")).toBe(" status");
  });

  it("takes the first word when there is no leading separator", () => {
    expect(nextSuggestionChunk("status --short")).toBe("status");
  });

  it("treats a slash as a separator for path completions", () => {
    expect(nextSuggestionChunk("/Users/me/project")).toBe("/Users");
  });

  it("treats a dash boundary inside flags as a stop point", () => {
    expect(nextSuggestionChunk("--dry-run")).toBe("--dry");
  });

  it("returns the whole remainder when it is a single word", () => {
    expect(nextSuggestionChunk("commit")).toBe("commit");
  });

  it("returns separators-only input verbatim", () => {
    expect(nextSuggestionChunk("   ")).toBe("   ");
  });
});
