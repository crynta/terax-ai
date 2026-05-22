import { describe, it, expect } from "vitest";
import { extractOutline } from "./outlineExtractor";

describe("extractOutline — TypeScript", () => {
  it("extracts top-level function declarations", () => {
    const src = `function hello() {}\nfunction world() {}`;
    const nodes = extractOutline(src, "ts");
    expect(nodes.map((n) => n.label)).toEqual(["hello", "world"]);
    expect(nodes.map((n) => n.kind)).toEqual(["function", "function"]);
  });

  it("extracts class declarations", () => {
    const src = `class Foo {}\nclass Bar {}`;
    const nodes = extractOutline(src, "ts");
    expect(nodes.map((n) => n.label)).toEqual(["Foo", "Bar"]);
    expect(nodes.map((n) => n.kind)).toEqual(["class", "class"]);
  });
});

describe("extractOutline — Markdown", () => {
  it("extracts headings with depth", () => {
    const src = `# H1\n## H2\n### H3`;
    const nodes = extractOutline(src, "md");
    expect(nodes.map((n) => n.label)).toEqual(["H1", "H2", "H3"]);
    expect(nodes.map((n) => n.depth)).toEqual([1, 2, 3]);
  });
});

describe("extractOutline — unsupported language", () => {
  it("returns empty array", () => {
    const nodes = extractOutline("any code", "txt");
    expect(nodes).toEqual([]);
  });
});
