import { describe, expect, it } from "vitest";
import { explorerGitTextClass } from "./gitStatusColor";

describe("explorer git status colors", () => {
  it("maps each status code to its tint", () => {
    expect(explorerGitTextClass("M")).toBe("text-amber-200/85");
    expect(explorerGitTextClass("A")).toBe("text-[#73C991]/90");
    expect(explorerGitTextClass("U")).toBe("text-[#73C991]/90");
    expect(explorerGitTextClass("R")).toBe("text-sky-300/85");
    expect(explorerGitTextClass("D")).toBe("text-rose-200/80");
  });

  it("treats adds and untracked identically", () => {
    expect(explorerGitTextClass("A")).toBe(explorerGitTextClass("U"));
  });
});
