import { describe, expect, it } from "vitest";
import { normalizeIndent } from "./normalizeIndent";

describe("normalizeIndent", () => {
  it("converts tab-led lines into a space file", () => {
    expect(normalizeIndent("if (x) {\n\ty();\n}", "  ")).toBe(
      "if (x) {\n  y();\n}",
    );
    expect(normalizeIndent("a {\n\t\tb();\n}", "    ")).toBe(
      "a {\n        b();\n}",
    );
  });

  it("converts space-led lines into a tab file", () => {
    expect(normalizeIndent("if x {\n    y()\n        z()\n}", "\t")).toBe(
      "if x {\n\ty()\n\t\tz()\n}",
    );
  });

  it("leaves ambiguous space widths alone in a tab file", () => {
    const mixed = "a\n   b\n    c";
    expect(normalizeIndent(mixed, "\t")).toBe(mixed);
  });

  it("does not touch the first line or single-line suggestions", () => {
    expect(normalizeIndent("\tx", "  ")).toBe("\tx");
    expect(normalizeIndent("x()", "  ")).toBe("x()");
  });

  it("leaves matching styles untouched", () => {
    const ok = "if (x) {\n  y();\n}";
    expect(normalizeIndent(ok, "  ")).toBe(ok);
  });

  it("converts mixed tab+space leads in a space file", () => {
    expect(normalizeIndent("a {\n\t  b();\n}", "  ")).toBe("a {\n    b();\n}");
  });
});
