import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { components, rehypePlugins } from "./RenderedMarkdown";

// Uses the real pipeline exported by RenderedMarkdown, so plugin order and
// sanitizer schema cannot drift from what the preview actually runs.
const render = (md: string) =>
  renderToStaticMarkup(
    <Streamdown
      mode="static"
      parseIncompleteMarkdown={false}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {md}
    </Streamdown>,
  );

// The lowercase row locks GitHub's case-insensitive marker matching.
const TYPES = [
  ["NOTE", "note", "Note"],
  ["TIP", "tip", "Tip"],
  ["IMPORTANT", "important", "Important"],
  ["WARNING", "warning", "Warning"],
  ["CAUTION", "caution", "Caution"],
  ["note", "note", "Note"],
] as const;

describe("rehypeGithubAlerts", () => {
  it("renders every alert type", () => {
    for (const [marker, cls, title] of TYPES) {
      const html = render(`> [!${marker}]\n> body text`);
      expect(html).toContain(
        `<div class="markdown-alert markdown-alert-${cls}">`,
      );
      expect(html).toContain(`<p class="markdown-alert-title">${title}</p>`);
      expect(html).toContain("body text");
      expect(html).not.toContain("<blockquote");
      expect(html).not.toContain(`[!${marker}]`);
    }
  });

  it("marker-line branches", () => {
    // Two trailing spaces after the marker are a GFM hard break: the marker
    // becomes its own text node followed by a <br>, both spliced out.
    const hardBreak = render(
      "> [!NOTE]  \n> See [docs](https://example.com) and `inline code`.\n>\n> - one\n> - two",
    );
    expect(hardBreak).toContain('class="markdown-alert markdown-alert-note"');
    expect(hardBreak).toContain(">Note</p>");
    expect(hardBreak).toContain('href="https://example.com/"');
    expect(hardBreak).toContain("inline code");
    expect(hardBreak).toContain("<li>one</li>");
    expect(hardBreak).toContain("<li>two</li>");
    expect(hardBreak).not.toContain("[!NOTE]");
    expect(hardBreak).not.toContain("<br");

    const markerOnly = render("> [!WARNING]");
    expect(markerOnly).toContain(
      'class="markdown-alert markdown-alert-warning"',
    );
    expect(markerOnly).toContain(">Warning</p>");
  });

  it("non-alerts stay plain blockquotes", () => {
    const rejected: [string, string][] = [
      ["> [!NOTE] heads up\n> body", "[!NOTE] heads up"],
      ["> [!NOTES]\n> body", "[!NOTES]"],
      ["> [!DANGER]\n> body", "[!DANGER]"],
      ["> intro line\n> [!NOTE]", "[!NOTE]"],
      ["> intro paragraph\n>\n> [!NOTE]\n> body", "[!NOTE]"],
    ];
    for (const [md, survivingMarker] of rejected) {
      const html = render(md);
      expect(html).toContain("<blockquote");
      expect(html).toContain(survivingMarker);
      expect(html).not.toContain("markdown-alert");
    }

    // An alert nested inside an alert: the outer transforms, the inner
    // stays a plain blockquote.
    const nested = render(
      "> [!NOTE]\n> outer body\n>\n> > [!TIP]\n> > inner body",
    );
    expect(nested).toContain('class="markdown-alert markdown-alert-note"');
    expect(nested).not.toContain("markdown-alert-tip");
    expect(nested).toContain("<blockquote");
    expect(nested).toContain("[!TIP]");
  });

  it("sanitizer enumerates values: unknown classes on raw divs are pruned", () => {
    const html = render('<div class="markdown-alert evil-hook">x</div>');
    expect(html).not.toContain("evil-hook");
  });
});
