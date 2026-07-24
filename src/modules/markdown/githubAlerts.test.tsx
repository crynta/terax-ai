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

const TYPES = [
  ["NOTE", "note", "Note"],
  ["TIP", "tip", "Tip"],
  ["IMPORTANT", "important", "Important"],
  ["WARNING", "warning", "Warning"],
  ["CAUTION", "caution", "Caution"],
] as const;

describe("rehypeGithubAlerts", () => {
  it.each(TYPES)(
    "[!%s] renders the classed alert structure through the full pipeline",
    (marker, cls, title) => {
      const html = render(`> [!${marker}]\n> body text`);
      expect(html).toContain(
        `<div class="markdown-alert markdown-alert-${cls}">`,
      );
      expect(html).toContain(`<p class="markdown-alert-title">${title}</p>`);
      expect(html).toContain("body text");
      expect(html).not.toContain("<blockquote");
      expect(html).not.toContain(`[!${marker}]`);
    },
  );

  it("matches the marker case-insensitively like GitHub", () => {
    const html = render("> [!note]\n> body");
    expect(html).toContain('class="markdown-alert markdown-alert-note"');
    expect(html).toContain(">Note</p>");
  });

  it("keeps the alert classes through the sanitizer", () => {
    const html = render("> [!CAUTION]\n> body");
    expect(html).toContain('class="markdown-alert markdown-alert-caution"');
    expect(html).toContain('class="markdown-alert-title"');
  });

  it("sanitizer enumerates values: unknown classes on raw divs are pruned", () => {
    const html = render('<div class="markdown-alert evil-hook">x</div>');
    expect(html).not.toContain("evil-hook");
  });

  it("alert content renders full markdown: links, code, lists", () => {
    const html = render(
      "> [!TIP]\n> See [docs](https://example.com) and `inline code`.\n>\n> - one\n> - two",
    );
    expect(html).toContain("markdown-alert-tip");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("inline code");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("a marker-only blockquote renders as an alert with just the title", () => {
    const html = render("> [!WARNING]");
    expect(html).toContain('class="markdown-alert markdown-alert-warning"');
    expect(html).toContain(">Warning</p>");
  });

  it("content on the marker line stays a plain blockquote", () => {
    const html = render("> [!NOTE] heads up\n> body");
    expect(html).toContain("<blockquote");
    expect(html).toContain("[!NOTE] heads up");
    expect(html).not.toContain("markdown-alert");
  });

  it("a misspelled or unknown type stays a plain blockquote", () => {
    for (const md of ["> [!NOTES]\n> body", "> [!DANGER]\n> body"]) {
      const html = render(md);
      expect(html).toContain("<blockquote");
      expect(html).not.toContain("markdown-alert");
    }
  });

  it("a marker preceded by content stays a plain blockquote", () => {
    for (const md of [
      "> intro line\n> [!NOTE]",
      "> intro paragraph\n>\n> [!NOTE]\n> body",
    ]) {
      const html = render(md);
      expect(html).toContain("<blockquote");
      expect(html).toContain("[!NOTE]");
      expect(html).not.toContain("markdown-alert");
    }
  });

  it("an alert nested inside a blockquote stays a plain blockquote", () => {
    const html = render("> > [!NOTE]\n> > inner");
    expect(html).not.toContain("markdown-alert");
    expect(html).toContain("[!NOTE]");
  });

  it("an alert nested inside an alert stays a plain blockquote", () => {
    const html = render(
      "> [!NOTE]\n> outer body\n>\n> > [!TIP]\n> > inner body",
    );
    expect(html).toContain('class="markdown-alert markdown-alert-note"');
    expect(html).not.toContain("markdown-alert-tip");
    expect(html).toContain("<blockquote");
    expect(html).toContain("[!TIP]");
  });

  it("a non-alert blockquote is untouched", () => {
    const html = render("> just a quote\n> second line");
    expect(html).toContain("<blockquote");
    expect(html).toContain("just a quote");
    expect(html).not.toContain("markdown-alert");
  });
});
