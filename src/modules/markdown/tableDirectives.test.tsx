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

const PIPE_TABLE = "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |";

describe("rehypeTableDirectives", () => {
  it("width directive stretches the next table", () => {
    const html = render(`<!-- table width="100%" -->\n${PIPE_TABLE}`);
    expect(html).toContain('<table width="100%">');
    expect(html).not.toContain("<!--");
  });

  it("cols=equal alone equalizes at natural width, no table width attr", () => {
    const html = render(`<!-- table cols="equal" -->\n${PIPE_TABLE}`);
    expect(html).toContain("<table><colgroup>");
    expect(html.match(/<col width="33\.333%"\/>/g)).toHaveLength(3);
  });

  it("width and cols combine in one directive", () => {
    const html = render(
      `<!-- table width="100%" cols="equal" -->\n${PIPE_TABLE}`,
    );
    expect(html).toContain('<table width="100%"><colgroup>');
    expect(html.match(/<col width="33\.333%"\/>/g)).toHaveLength(3);
  });

  it("stacked directive comments all apply", () => {
    const html = render(
      `<!-- table width="100%" -->\n<!-- table cols="equal" -->\n${PIPE_TABLE}`,
    );
    expect(html).toContain('<table width="100%"><colgroup>');
  });

  it("accepts single-quoted and unquoted attribute values", () => {
    expect(render(`<!-- table width='100%' -->\n${PIPE_TABLE}`)).toContain(
      '<table width="100%">',
    );
    expect(render(`<!-- table width=100% -->\n${PIPE_TABLE}`)).toContain(
      '<table width="100%">',
    );
  });

  it("applies across a blank line before the table", () => {
    const html = render(`<!-- table width="100%" -->\n\n${PIPE_TABLE}`);
    expect(html).toContain('<table width="100%">');
  });

  it("explicit cols set widths without implying table width", () => {
    const html = render(`<!-- table cols="12%, auto, 25%" -->\n${PIPE_TABLE}`);
    expect(html).not.toContain('table width="100%"');
    expect(html).toContain('<col width="12%"/>');
    expect(html).toContain('<col width="25%"/>');
    expect(html.match(/<col\/>/g)).toHaveLength(1);
  });

  it("drops cols entries beyond the actual column count", () => {
    const html = render(
      `<!-- table cols="10%, 20%, 30%, 40%, 50%" -->\n${PIPE_TABLE}`,
    );
    expect(html.match(/<col width=/g)).toHaveLength(3);
    expect(html).not.toContain("40%");
  });

  it("tables without a directive are untouched", () => {
    const html = render(PIPE_TABLE);
    expect(html).not.toContain("width=");
    expect(html).not.toContain("colgroup");
  });

  it("ordinary comments do not affect tables", () => {
    const html = render(`<!-- just a note -->\n${PIPE_TABLE}`);
    expect(html).not.toContain("width=");
  });

  it("a directive with no adjacent table is a no-op", () => {
    const html = render('<!-- table width="100%" -->\n\nJust a paragraph.');
    expect(html).toContain("Just a paragraph.");
    expect(html).not.toContain("width=");
  });

  it("directive values cannot inject elements or attributes", () => {
    const html = render(
      `<!-- table cols="&quot;><img src=x onerror=alert(1)>" -->\n${PIPE_TABLE}`,
    );
    expect(html).not.toContain("<img");
  });

  it("dangerous markup in cells is still stripped by the sanitizer", () => {
    const html = render(
      `<!-- table cols="equal" -->\n| <script>x()</script> a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |`,
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("colgroup");
  });
});
