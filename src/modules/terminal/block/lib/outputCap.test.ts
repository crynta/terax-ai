import { describe, expect, it } from "vitest";
import { capAttachOutput } from "./outputCap";

describe("capAttachOutput", () => {
  it("returns short output untouched", () => {
    const text = "line1\nline2\nline3";
    expect(capAttachOutput(text)).toBe(text);
  });

  it("keeps head and tail when over the line cap", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
    const out = capAttachOutput(lines.join("\n"), 300);
    const outLines = out.split("\n");
    expect(outLines.length).toBe(301);
    expect(outLines[0]).toBe("line0");
    expect(outLines[59]).toBe("line59");
    expect(outLines[60]).toBe("[... 700 lines truncated ...]");
    expect(outLines[outLines.length - 1]).toBe("line999");
  });

  it("caps by chars when few but huge lines", () => {
    const text = "x".repeat(100_000);
    const out = capAttachOutput(text, 300, 24_000);
    expect(out.length).toBeLessThan(25_000);
    expect(out).toContain("[... output truncated ...]");
    expect(out.startsWith("x")).toBe(true);
    expect(out.endsWith("x")).toBe(true);
  });

  it("applies both caps in sequence", () => {
    const lines = Array.from({ length: 500 }, () => "y".repeat(200));
    const out = capAttachOutput(lines.join("\n"), 300, 24_000);
    expect(out.length).toBeLessThan(25_000);
    expect(out).toContain("truncated");
  });
});
