import { describe, expect, it } from "vitest";
import { detectIndentUnit } from "./indent";

const twoSpace = `function a() {\n  if (x) {\n    y();\n  }\n}\n`;
const fourSpace = `def a():\n    if x:\n        y()\n    return\n`;
const tabbed = `fn a() {\n\tif x {\n\t\ty();\n\t}\n}\n`;

describe("detectIndentUnit", () => {
  it("detects two spaces", () => {
    expect(detectIndentUnit(twoSpace)).toBe("  ");
  });

  it("detects four spaces", () => {
    expect(detectIndentUnit(fourSpace)).toBe("    ");
  });

  it("detects tabs", () => {
    expect(detectIndentUnit(tabbed)).toBe("\t");
  });

  it("falls back for flat files", () => {
    expect(detectIndentUnit("a\nb\nc\n")).toBe("  ");
    expect(detectIndentUnit("")).toBe("  ");
  });

  it("ignores whitespace-only lines", () => {
    expect(detectIndentUnit("a {\n    \n  b\n    c\n}\n")).toBe("  ");
  });

  it("majority wins on mixed tab/space files", () => {
    const mixed = `a {\n\tb\n\tc\n\td\n  e\n}\n`;
    expect(detectIndentUnit(mixed)).toBe("\t");
  });
});
