import { describe, expect, it } from "vitest";
import { detectEol, normalizeToLf, restoreEol } from "./eol";

describe("detectEol", () => {
  it("detects LF", () => {
    expect(detectEol("a\nb\nc")).toBe("\n");
  });

  it("detects CRLF", () => {
    expect(detectEol("a\r\nb\r\nc")).toBe("\r\n");
  });

  it("majority wins on mixed endings", () => {
    expect(detectEol("a\r\nb\r\nc\nd")).toBe("\r\n");
    expect(detectEol("a\nb\nc\r\nd")).toBe("\n");
  });

  it("defaults to LF for single-line content", () => {
    expect(detectEol("no line breaks")).toBe("\n");
    expect(detectEol("")).toBe("\n");
  });

  it("ties resolve to LF", () => {
    expect(detectEol("a\r\nb\nc")).toBe("\n");
  });
});

describe("normalizeToLf", () => {
  it("converts CRLF and lone CR", () => {
    expect(normalizeToLf("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("returns the same string when no CR present", () => {
    const s = "a\nb";
    expect(normalizeToLf(s)).toBe(s);
  });
});

describe("restoreEol", () => {
  it("round-trips CRLF content", () => {
    const original = "a\r\nb\r\nc";
    const eol = detectEol(original);
    expect(restoreEol(normalizeToLf(original), eol)).toBe(original);
  });

  it("leaves LF content untouched", () => {
    expect(restoreEol("a\nb", "\n")).toBe("a\nb");
  });
});
