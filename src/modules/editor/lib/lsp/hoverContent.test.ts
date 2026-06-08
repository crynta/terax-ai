import { describe, expect, it } from "vitest";
import { parseHoverContents } from "./hoverContent";

describe("parseHoverContents", () => {
  it("parses markdown MarkupContent", () => {
    const blocks = parseHoverContents({
      kind: "markdown",
      value: "```rs\nfn foo() {}\n```\n\nHello",
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("markdown");
    expect(blocks[0].text).toContain("```rs");
  });

  it("parses MarkedString array", () => {
    const blocks = parseHoverContents([
      "pub fn sleep()",
      { kind: "markdown", value: "Waits until duration has elapsed." },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("plaintext");
    expect(blocks[1].kind).toBe("markdown");
  });

  it("truncates extremely long documentation", () => {
    const blocks = parseHoverContents({
      kind: "markdown",
      value: `# Tokio\n\n${"word ".repeat(2000)}`,
    });
    expect(blocks[0].text.length).toBeLessThan(2000);
    expect(blocks[0].text.endsWith("…")).toBe(true);
  });
});
