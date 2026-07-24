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

type DirectiveCase = {
  name: string;
  md: string;
  contains?: string[];
  absent?: string[];
  counts?: [RegExp, number][];
};

const check = ({
  md,
  contains = [],
  absent = [],
  counts = [],
}: DirectiveCase) => {
  const html = render(md);
  for (const fragment of contains) expect(html).toContain(fragment);
  for (const fragment of absent) expect(html).not.toContain(fragment);
  for (const [pattern, count] of counts)
    expect(html.match(pattern)).toHaveLength(count);
};

const APPLY_CASES: DirectiveCase[] = [
  {
    name: "width stretches the next table and the comment is stripped",
    md: `<!-- table width="100%" -->\n${PIPE_TABLE}`,
    contains: ['<table width="100%">'],
    absent: ["<!--"],
  },
  {
    name: "cols=equal alone equalizes at natural width, no table width attr",
    md: `<!-- table cols="equal" -->\n${PIPE_TABLE}`,
    contains: ["<table><colgroup>"],
    counts: [[/<col width="33\.333%"\/>/g, 3]],
  },
  {
    name: "width and cols combine in one directive",
    md: `<!-- table width="100%" cols="equal" -->\n${PIPE_TABLE}`,
    contains: ['<table width="100%"><colgroup>'],
    counts: [[/<col width="33\.333%"\/>/g, 3]],
  },
  {
    name: "stacked directive comments all apply",
    md: `<!-- table width="100%" -->\n<!-- table cols="equal" -->\n${PIPE_TABLE}`,
    contains: ['<table width="100%"><colgroup>'],
  },
  {
    name: "single-quoted attribute values are accepted",
    md: `<!-- table width='100%' -->\n${PIPE_TABLE}`,
    contains: ['<table width="100%">'],
  },
  {
    name: "unquoted attribute values are accepted",
    md: `<!-- table width=100% -->\n${PIPE_TABLE}`,
    contains: ['<table width="100%">'],
  },
  {
    name: "applies across a blank line before the table",
    md: `<!-- table width="100%" -->\n\n${PIPE_TABLE}`,
    contains: ['<table width="100%">'],
  },
  {
    name: "explicit cols set widths, auto stays attributeless, no implied table width",
    md: `<!-- table cols="12%, auto, 25%" -->\n${PIPE_TABLE}`,
    contains: ['<col width="12%"/>', '<col width="25%"/>'],
    absent: ['table width="100%"'],
    counts: [[/<col\/>/g, 1]],
  },
  {
    name: "cols entries beyond the actual column count are dropped",
    md: `<!-- table cols="10%, 20%, 30%, 40%, 50%" -->\n${PIPE_TABLE}`,
    absent: ["40%"],
    counts: [[/<col width=/g, 3]],
  },
];

const NOOP_CASES: DirectiveCase[] = [
  {
    name: "a table without a directive gains neither width nor colgroup",
    md: PIPE_TABLE,
    absent: ["width=", "colgroup"],
  },
  {
    name: "an ordinary comment does not affect the table",
    md: `<!-- just a note -->\n${PIPE_TABLE}`,
    absent: ["width="],
  },
  {
    name: "a directive with no adjacent table does nothing",
    md: '<!-- table width="100%" -->\n\nJust a paragraph.',
    contains: ["Just a paragraph."],
    absent: ["width="],
  },
];

describe("rehypeTableDirectives", () => {
  it("applies directives", () => {
    for (const c of APPLY_CASES) check(c);
  });

  it("ignores non-directives and directives without a table", () => {
    for (const c of NOOP_CASES) check(c);
  });

  it("directive values cannot inject elements or attributes", () => {
    const injected = render(
      `<!-- table cols="&quot;><img src=x onerror=alert(1)>" -->\n${PIPE_TABLE}`,
    );
    expect(injected).not.toContain("<img");

    const cellMarkup = render(
      `<!-- table cols="equal" -->\n| <script>x()</script> a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |`,
    );
    expect(cellMarkup).not.toContain("<script");
    expect(cellMarkup).toContain("colgroup");
  });
});
