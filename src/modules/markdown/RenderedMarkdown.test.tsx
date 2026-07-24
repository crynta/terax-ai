import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RenderedMarkdown } from "./RenderedMarkdown";

const render = (content: string) =>
  renderToStaticMarkup(<RenderedMarkdown content={content} />);

describe("RenderedMarkdown", () => {
  it("keeps <pre> for plain fences, whitespace preserved", () => {
    const html = render("```\na\n  b\n```");
    expect(html).toMatch(/<pre/);
    expect(html).toContain("a\n  b");
  });

  it("unwraps language fences so ChatCodeBlock owns the block", () => {
    const html = render("```ts\nconst x = 1;\n```");
    expect(html).not.toMatch(/<pre[^>]*><div/);
    expect(html).toContain("not-prose");
  });

  it("renders frontmatter keys as the table header row", () => {
    const html = render("---\nname: demo\ndescription: A thing\n---\nBody\n");
    expect(html).toContain("<th>name</th>");
    expect(html).toContain("<th>description</th>");
    expect(html).toContain("Body");
  });

  it("renders frontmatter values as inert text, never HTML", () => {
    const html = render("---\nname: <img src=x onerror=alert(1)>\n---\nBody\n");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("shell blocks keep copy but omit run-in-terminal in the preview", () => {
    const html = render("```bash\nls -la\n```");
    expect(html).toContain('aria-label="Copy code"');
    expect(html).not.toContain("Run in active terminal");
  });

  it("renders duplicate frontmatter keys without collapsing entries", () => {
    const html = render("---\nname: a\nname: b\n---\nBody\n");
    expect(html.match(/<th>name<\/th>/g)).toHaveLength(2);
  });

  it("keeps GFM on through Streamdown's default remark plugins", () => {
    const html = render(
      "~~gone~~\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done",
    );
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain("<table>");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
  });

  it("renders script, iframe, style and event handlers inert", () => {
    expect(render("<script>alert(1)</script>ok")).not.toContain("<script");
    expect(render('<iframe src="https://x"></iframe>\n\nok')).not.toContain(
      "<iframe",
    );
    expect(render("<style>p{color:red}</style>\n\nok")).not.toContain("<style");
    const html = render('<div onclick="alert(1)">text</div>');
    expect(html).toContain("<div>text</div>");
    expect(html.toLowerCase()).not.toContain("onclick");
  });

  it("renders GitHub-allowed raw HTML: kbd, details/summary, sub/sup", () => {
    const html = render(
      "press <kbd>Ctrl</kbd>\n\n<details><summary>More</summary>body</details>\n\nH<sub>2</sub>O and e=mc<sup>2</sup>",
    );
    expect(html).toContain("<kbd>Ctrl</kbd>");
    expect(html).toContain("<summary>More</summary>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
  });

  it("external links keep href and destination tooltip; fragments stay", () => {
    const html = render("[ext](https://example.com/x) [frag](#section)");
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('title="https://example.com/x"');
    expect(html).toContain('href="#section"');
    // Our anchor, not Streamdown's link-safety button.
    expect(html).not.toContain("<button");
  });

  it("degrades bare relative file links to plain text, no blocked badge", () => {
    const html = render("see [the docs](docs/guide.md) for more");
    expect(html).toContain("<span>the docs</span>");
    expect(html).not.toContain("[blocked]");
    expect(html).not.toContain("docs/guide.md");
  });

  it("keeps GitHub table markup free of Streamdown chrome", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).not.toContain("data-streamdown");
  });

  // The unified pipeline recurses per nesting level; pathological depth
  // overflows the call stack during render, which the pane's error boundary
  // converts to the Raw-view hint in the client. Static server rendering
  // has no boundaries, so the throw itself is the observable here.
  it("pathological nesting fails inside the render, not past it", () => {
    const deep = `${"> ".repeat(2000)}x`;
    expect(() => render(deep)).toThrow();
  });

  it("7k-line document stays a one-time static parse (#913 class)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 7000; i++) {
      lines.push(
        i % 50 === 0 ? `## Heading ${i}` : `line ${i} with *em* and \`code\``,
      );
    }
    const start = performance.now();
    const html = render(lines.join("\n"));
    const ms = performance.now() - start;
    console.info(
      `[markdown perf] 7000-line static render: ${Math.round(ms)}ms`,
    );
    expect(html).toContain("Heading 6950");
    // Coarse guard only: the static path lands well under a second here;
    // the streaming path #913 removed measured ~3.3s on a comparable doc.
    // The threshold splits the two regimes without being CI-flaky.
    expect(ms).toBeLessThan(3000);
  });
});
