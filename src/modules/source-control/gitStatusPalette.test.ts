import { describe, expect, it } from "vitest";
import { gitStatusAccentClass, gitStatusTextClass } from "./gitStatusPalette";

describe("gitStatusPalette", () => {
  it("maps accent classes for the SCM panel", () => {
    expect(gitStatusAccentClass("U")).toBe("bg-teal-500/85");
    expect(gitStatusAccentClass("A")).toBe("bg-emerald-500/85");
    expect(gitStatusAccentClass("M")).toBe("bg-amber-500/85");
    expect(gitStatusAccentClass("D")).toBe("bg-rose-500/85");
    expect(gitStatusAccentClass("R")).toBe("bg-sky-500/85");
    expect(gitStatusAccentClass("C")).toBe("bg-sky-500/85");
    expect(gitStatusAccentClass("X")).toBe("bg-muted-foreground/40");
  });

  it("maps text classes for file badges", () => {
    expect(gitStatusTextClass("U")).toContain("teal");
    expect(gitStatusTextClass("A")).toContain("emerald");
    expect(gitStatusTextClass("M")).toContain("amber");
    expect(gitStatusTextClass("D")).toContain("rose");
    expect(gitStatusTextClass("R")).toContain("sky");
    expect(gitStatusTextClass("C")).toContain("sky");
    expect(gitStatusTextClass("X")).toBe("text-muted-foreground");
  });
});
